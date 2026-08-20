/**
 * features/capture/CapturePage.tsx — Flujo completo de análisis.
 *
 * Estados: form → capturing → preview → uploading → analyzing → results | failed.
 * Progreso en vivo vía WebSocket sobre el topic `user:{userId}`.
 * Si la red está caída en el momento de "Enviar", el blob se encola en
 * IndexedDB y se sube cuando vuelva la conexión.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CameraCapture, type CaptureQuality } from './CameraCapture';
import { AnalysisResultsView } from './AnalysisResultsView';
import { Disclaimer } from '../../components/common/Disclaimer';
import { farmerApi } from '../../lib/api/endpoints/farmer';
import { analysisApi, type AnalysisDetail } from '../../lib/api/endpoints/analysis';
import { useAuthStore } from '../../lib/auth/store';
import { useLiveTopic } from '../../lib/ws/useAnalysisLive';
import { offlineQueue } from '../../lib/offline/queue';
import { ApiError } from '../../lib/api/client';
import { ArrowLeft, RefreshCw, Camera, AlertCircle, CheckCircle2, Loader2, CloudOff, Coffee, Scale, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';

type Phase =
  | { name: 'form' }
  | { name: 'capturing' }
  | { name: 'preview'; blob: Blob; quality: CaptureQuality }
  | { name: 'uploading'; blob: Blob; quality: CaptureQuality; pct: number }
  | { name: 'analyzing'; analysisId: string; pct: number }
  | { name: 'results'; analysis: AnalysisDetail }
  | { name: 'failed'; message: string }
  | { name: 'queued'; reason: string };

export function CapturePage() {
  const user = useAuthStore((s) => s.user);
  const [farmId, setFarmId] = useState('');
  const [grainType, setGrainType] = useState<'cereza' | 'pergamino' | 'trilla'>('cereza');
  const [sampleWeightG, setSampleWeightG] = useState<number>(100);
  const [phase, setPhase] = useState<Phase>({ name: 'form' });

  const farmsQuery = useQuery({
    queryKey: ['farms', 'mine'],
    queryFn: () => farmerApi.listFarms(),
    enabled: !!user,
  });

  useEffect(() => {
    if (!farmId && farmsQuery.data && farmsQuery.data.length > 0) {
      setFarmId(farmsQuery.data[0]!.id);
    }
  }, [farmsQuery.data, farmId]);

  // Suscripción WS sólo cuando hay análisis en curso
  const liveTopic = useMemo(
    () => (phase.name === 'analyzing' && user ? `user:${user.id}` : null),
    [phase, user],
  );

  useLiveTopic(liveTopic, async (evt) => {
    if (phase.name !== 'analyzing') return;
    if (evt.type === 'analysis.progress' && evt.payload.analysisId === phase.analysisId) {
      const pct = evt.payload.pct ?? phase.pct;
      setPhase({ ...phase, pct });
    } else if (evt.type === 'analysis.completed' && evt.payload.analysisId === phase.analysisId) {
      try {
        const detail = await analysisApi.get(phase.analysisId);
        setPhase({ name: 'results', analysis: detail });
      } catch {
        setPhase({ name: 'failed', message: 'No se pudo cargar el resultado.' });
      }
    } else if (evt.type === 'analysis.failed' && evt.payload.analysisId === phase.analysisId) {
      setPhase({ name: 'failed', message: evt.payload.error });
    }
  });

  async function submitBlob(blob: Blob, quality: CaptureQuality) {
    if (!farmId) {
      setPhase({ name: 'failed', message: 'Selecciona una finca antes de enviar.' });
      return;
    }
    setPhase({ name: 'uploading', blob, quality, pct: 0 });
    try {
      const created = await analysisApi.submit(
        {
          farmId,
          grainType,
          sampleWeightG,
          captureConditions: {
            luminance: quality.luminance,
            contrast: quality.contrast,
            qualityLabel: quality.label,
          },
          file: new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }),
        },
        { onProgress: (pct) => setPhase({ name: 'uploading', blob, quality, pct }) },
      );
      // Si el backend dedupeó y ya hay resultado, cárgalo de inmediato.
      const createdStatus = (
        (created as { status?: string; processingStatus?: string }).status
        ?? (created as { processingStatus?: string }).processingStatus
      );
      const terminal = createdStatus === 'completed' || createdStatus === 'failed';
      if (terminal) {
        try {
          const detail = await analysisApi.get(created.id);
          if (createdStatus === 'failed') {
            setPhase({ name: 'failed', message: detail.errorMessage ?? 'El análisis falló previamente.' });
          } else {
            setPhase({ name: 'results', analysis: detail });
          }
          return;
        } catch {
          // Cae al flujo normal de polling/WS
        }
      }
      setPhase({ name: 'analyzing', analysisId: created.id, pct: 0 });
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      const offlineLike =
        !navigator.onLine ||
        apiErr?.code === 'ERR_NETWORK' ||
        apiErr?.code === 'ECONNABORTED';
      if (offlineLike) {
        await offlineQueue.enqueue({
          farmId,
          grainType,
          sampleWeightG,
          captureConditions: { luminance: quality.luminance, contrast: quality.contrast, qualityLabel: quality.label },
          filename: `capture-${Date.now()}.jpg`,
          mime: 'image/jpeg',
          blob,
        });
        setPhase({
          name: 'queued',
          reason: 'La conexión falló. El análisis fue guardado y se enviará cuando vuelva la red.',
        });
      } else {
        setPhase({ name: 'failed', message: apiErr?.message ?? 'Error al subir la imagen.' });
      }
    }
  }

  function reset() { setPhase({ name: 'form' }); }

  async function handleFileUpload(file: File) {
    if (!farmId) {
      setPhase({ name: 'failed', message: 'Selecciona una finca antes de cargar la imagen.' });
      return;
    }
    if (!file.type.startsWith('image/')) {
      setPhase({ name: 'failed', message: 'El archivo debe ser una imagen (JPG, PNG, WEBP).' });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setPhase({ name: 'failed', message: 'La imagen excede 15 MB. Elige una más ligera.' });
      return;
    }
    try {
      const quality = await evaluateImageBlob(file);
      setPhase({ name: 'preview', blob: file, quality });
    } catch {
      setPhase({ name: 'preview', blob: file, quality: { luminance: 128, contrast: 30, label: 'media' } });
    }
  }

  if (!user) {
    return (
      <div className="cv-card p-6 max-w-md mx-auto mt-12 text-center">
        Inicia sesión para registrar análisis.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      <header className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
          <Camera size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Nuevo análisis</h1>
          <p className="text-sm" style={{ color: 'var(--color-text-mute)' }}>
            Foto del grano → análisis trazable.
          </p>
        </div>
      </header>
      <Disclaimer />

      {phase.name === 'form' && (
        <section className="cv-card p-5 sm:p-6 space-y-5">
          <div>
            <label className="cv-label">Finca</label>
            {farmsQuery.isLoading ? (
              <div className="cv-skeleton h-10" />
            ) : !farmsQuery.data || farmsQuery.data.length === 0 ? (
              <div className="cv-card p-3 flex items-start gap-2"
                   style={{ borderColor: 'var(--color-warning)', background: '#FFF8EC', color: 'var(--color-warning)' }}>
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium">No tienes fincas registradas.</p>
                  <p className="opacity-80">
                    Crea una en{' '}
                    <Link to="/profile" className="underline font-medium">tu perfil</Link>{' '}
                    para poder analizar.
                  </p>
                </div>
              </div>
            ) : (
              <select
                value={farmId}
                onChange={(e) => setFarmId(e.target.value)}
                className="cv-input"
              >
                {farmsQuery.data.map((f) => (
                  <option key={f.id} value={f.id}>{f.nombre_finca}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="cv-label">Tipo de grano</label>
            <div className="grid grid-cols-3 gap-2">
              {(['cereza','pergamino','trilla'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrainType(g)}
                  className="p-3 rounded-xl border text-sm font-medium capitalize transition-all"
                  style={{
                    borderColor: grainType === g ? 'var(--color-primary)' : 'var(--color-border)',
                    background:  grainType === g ? 'var(--color-primary-soft)' : 'var(--color-surface)',
                    color:       grainType === g ? 'var(--color-primary)' : 'var(--color-text-soft)',
                  }}
                >
                  <Coffee size={16} className="inline mr-1 -mt-0.5" /> {g}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="cv-label">Peso de la muestra (g)</label>
            <div className="relative">
              <Scale size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
                     style={{ color: 'var(--color-text-mute)' }} />
              <input
                type="number" min={1} max={5000} inputMode="numeric"
                value={sampleWeightG}
                onChange={(e) => setSampleWeightG(Math.max(1, Number(e.target.value) || 0))}
                className="cv-input pl-9"
              />
            </div>
          </div>

          <button
            onClick={() => setPhase({ name: 'capturing' })}
            disabled={!farmId}
            className="cv-btn cv-btn-primary cv-btn-lg w-full"
          >
            <Camera size={18} /> Tomar foto con la cámara
          </button>

          <div className="flex items-center gap-2 text-xs uppercase tracking-wider"
               style={{ color: 'var(--color-text-mute)' }}>
            <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
            o
            <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
          </div>

          <label
            className={`cv-btn cv-btn-outline cv-btn-lg w-full cursor-pointer ${!farmId ? 'opacity-50 cursor-not-allowed' : ''}`}
            aria-disabled={!farmId}
          >
            <Upload size={18} /> Cargar imagen desde el dispositivo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={!farmId}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void handleFileUpload(f);
              }}
            />
          </label>
        </section>
      )}

      {phase.name === 'capturing' && (
        <section className="space-y-3">
          <button onClick={reset} className="cv-btn cv-btn-ghost cv-btn-sm">
            <ArrowLeft size={16} /> Cambiar parámetros
          </button>
          <CameraCapture onCaptured={(blob, q) => setPhase({ name: 'preview', blob, quality: q })} />
        </section>
      )}

      {phase.name === 'preview' && (
        <section className="cv-card overflow-hidden">
          <img
            src={URL.createObjectURL(phase.blob)}
            alt="Captura"
            className="w-full max-h-[60vh] object-contain bg-black"
          />
          <div className="p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2">
              {phase.quality.label === 'insuficiente' || phase.quality.label === 'baja' ? (
                <span className="cv-chip cv-chip-warning">
                  <AlertCircle size={14} /> Calidad: {phase.quality.label}
                </span>
              ) : (
                <span className="cv-chip cv-chip-success">
                  <CheckCircle2 size={14} /> Calidad: {phase.quality.label}
                </span>
              )}
            </div>
            {(phase.quality.label === 'insuficiente' || phase.quality.label === 'baja') && (
              <p className="text-sm" style={{ color: 'var(--color-text-mute)' }}>
                Recomendamos repetir con mejor iluminación para resultados más confiables.
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
              <button onClick={() => setPhase({ name: 'capturing' })} className="cv-btn cv-btn-outline">
                <RefreshCw size={16} /> Repetir
              </button>
              <button onClick={() => submitBlob(phase.blob, phase.quality)} className="cv-btn cv-btn-primary">
                Enviar para análisis
              </button>
            </div>
          </div>
        </section>
      )}

      {phase.name === 'uploading' && (
        <ProgressCard
          title="Subiendo imagen"
          subtitle="Encriptando y enviando al servidor…"
          pct={phase.pct}
          accent="var(--color-primary)"
        />
      )}

      {phase.name === 'analyzing' && (
        <ProgressCard
          title="Procesando análisis"
          subtitle="El motor está midiendo cada grano. Esto puede tardar varios segundos."
          pct={Math.max(phase.pct, 5)}
          accent="var(--color-accent)"
        />
      )}

      {phase.name === 'queued' && (
        <section className="cv-card p-5 sm:p-6 text-center space-y-3">
          <span className="w-12 h-12 rounded-full mx-auto flex items-center justify-center"
                style={{ background: '#FFF1D6', color: 'var(--color-warning)' }}>
            <CloudOff size={22} />
          </span>
          <h2 className="font-semibold">Guardado en cola</h2>
          <p className="text-sm" style={{ color: 'var(--color-text-soft)' }}>{phase.reason}</p>
          <button onClick={reset} className="cv-btn cv-btn-primary">
            <Camera size={16} /> Hacer otra captura
          </button>
        </section>
      )}

      {phase.name === 'failed' && (
        <section className="cv-card p-5 sm:p-6 text-center space-y-3">
          <span className="w-12 h-12 rounded-full mx-auto flex items-center justify-center"
                style={{ background: '#FCD7D5', color: 'var(--color-danger)' }}>
            <AlertCircle size={22} />
          </span>
          <h2 className="font-semibold">No se pudo completar</h2>
          <p className="text-sm" style={{ color: 'var(--color-text-soft)' }}>{phase.message}</p>
          <button onClick={reset} className="cv-btn cv-btn-primary">
            <RefreshCw size={16} /> Intentar de nuevo
          </button>
        </section>
      )}

      {phase.name === 'results' && (
        <>
          <AnalysisResultsView analysis={phase.analysis} />
          <div className="text-right">
            <button onClick={reset} className="cv-btn cv-btn-primary">
              <Camera size={16} /> Nuevo análisis
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ProgressCard({ title, subtitle, pct, accent }: { title: string; subtitle: string; pct: number; accent: string }) {
  return (
    <section className="cv-card p-5 sm:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'var(--color-primary-soft)', color: accent }}>
          <Loader2 size={20} className="animate-spin" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm" style={{ color: 'var(--color-text-mute)' }}>{subtitle}</p>
        </div>
        <span className="text-2xl font-bold tabular-nums" style={{ color: accent }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
        <div className="h-full transition-all rounded-full"
             style={{ width: `${pct}%`, background: accent }} />
      </div>
    </section>
  );
}

/**
 * Evalúa la calidad de una imagen subida (luminancia + desv. estándar como
 * proxy de contraste/foco) replicando el algoritmo de CameraCapture.
 */
async function evaluateImageBlob(blob: Blob): Promise<CaptureQuality> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image_load_failed'));
      i.src = url;
    });
    const w = 64;
    const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no_canvas_ctx');
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let sum = 0, sumSq = 0; const n = w * h;
    for (let i = 0; i < data.length; i += 4) {
      const y = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      sum += y; sumSq += y * y;
    }
    const mean = sum / n;
    const variance = Math.max(0, sumSq / n - mean * mean);
    const stddev = Math.sqrt(variance);
    let label: CaptureQuality['label'];
    if (mean < 40 || mean > 230 || stddev < 12) label = 'insuficiente';
    else if (stddev < 22) label = 'baja';
    else if (stddev < 40) label = 'media';
    else label = 'buena';
    return { luminance: mean, contrast: stddev, label };
  } finally {
    URL.revokeObjectURL(url);
  }
}
