/**
 * features/capture/CameraCapture.tsx — Captura de fotografía vía getUserMedia.
 *
 * Devuelve un Blob real (JPEG calidad 0.92) y NO una data URL. Esto evita el
 * doble codificado base64 → binary al subir al backend.
 *
 * Limitaciones honestas:
 *  - Si el navegador deniega permisos, se muestra error real (no fallback fake).
 *  - El indicador de "calidad" mide cosas reales: luminancia media y varianza
 *    (proxy de contraste). No miente con porcentajes inventados.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, AlertCircle } from 'lucide-react';

export interface CaptureQuality {
  /** Luminancia media 0–255 calculada sobre downsample del frame. */
  luminance: number;
  /** Desviación estándar de luminancia (proxy de contraste/foco). */
  contrast: number;
  /** Etiqueta determinista derivada de las medidas. */
  label: 'insuficiente' | 'baja' | 'media' | 'buena';
}

interface Props {
  onCaptured: (blob: Blob, quality: CaptureQuality) => void;
  facingMode?: 'environment' | 'user';
}

function evaluateFrame(video: HTMLVideoElement): CaptureQuality | null {
  const w = 64;
  const h = Math.round((video.videoHeight / video.videoWidth) * w) || 48;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
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
}

export function CameraCapture({ onCaptured, facingMode = 'environment' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [quality, setQuality] = useState<CaptureQuality | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
      }
    } catch (e) {
      const err = e as DOMException;
      if (err.name === 'NotAllowedError') setError('Permiso de cámara denegado.');
      else if (err.name === 'NotFoundError') setError('No se encontró ninguna cámara.');
      else setError(`No se pudo iniciar la cámara: ${err.message ?? 'error desconocido'}`);
    }
  }, [facingMode]);

  useEffect(() => {
    start();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [start]);

  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      if (videoRef.current) setQuality(evaluateFrame(videoRef.current));
    }, 600);
    return () => clearInterval(id);
  }, [ready]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const q = evaluateFrame(video) ?? { luminance: 0, contrast: 0, label: 'insuficiente' as const };
    canvas.toBlob(
      (blob) => {
        if (blob) onCaptured(blob, q);
      },
      'image/jpeg',
      0.92,
    );
  }, [onCaptured]);

  if (error) {
    return (
      <div className="cv-card p-6 text-center" role="alert">
        <AlertCircle className="mx-auto mb-3" style={{ color: 'var(--color-danger)' }} />
        <p className="font-medium" style={{ color: 'var(--color-text)' }}>{error}</p>
        <button
          onClick={start}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded text-white"
          style={{ background: 'var(--color-primary)' }}
        >
          <RefreshCw size={16} /> Reintentar
        </button>
      </div>
    );
  }

  const borderColor =
    quality?.label === 'buena' ? 'var(--score-best)'
    : quality?.label === 'media' ? 'var(--score-good)'
    : quality?.label === 'baja' ? 'var(--score-mid)'
    : 'var(--score-bad)';

  return (
    <div className="relative">
      <div
        className="relative overflow-hidden rounded-lg border-4 transition-colors"
        style={{ borderColor }}
      >
        <video ref={videoRef} playsInline muted className="w-full h-auto block" />
        {!ready ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
            Iniciando cámara…
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <div style={{ color: 'var(--color-text-soft)' }}>
          {quality
            ? <>Calidad de toma: <strong>{quality.label}</strong> · L̄ {quality.luminance.toFixed(0)} · σ {quality.contrast.toFixed(0)}</>
            : 'Evaluando…'}
        </div>
        <button
          onClick={capture}
          disabled={!ready}
          className="inline-flex items-center gap-2 px-4 py-2 rounded text-white disabled:opacity-50"
          style={{ background: 'var(--color-primary)' }}
        >
          <Camera size={16} /> Tomar foto
        </button>
      </div>
    </div>
  );
}
