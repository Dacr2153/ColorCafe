/**
 * features/marketplace/MyListingsPage.tsx — Productor: gestión de lotes.
 *
 * Clave honesta: el productor selecciona un análisis EXISTENTE de su cuenta
 * para crear un lote. El `quality_score` se copia del análisis al ser revisado
 * por un administrador (en backend). NUNCA se permite editarlo manualmente.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { marketApi, type ListingProcess, type Listing } from '../../lib/api/endpoints/market';
import { analysisApi } from '../../lib/api/endpoints/analysis';
import { EmptyState } from '../../components/common/EmptyState';
import { ApiError } from '../../lib/api/client';
import { Plus, Pause, Play, Trash2, ShieldCheck, Clock, Package, X, AlertCircle } from 'lucide-react';

const STATUS_LABEL: Record<Listing['status'], { label: string; color: string }> = {
  pending_review: { label: 'En revisión', color: 'var(--color-warning)' },
  active:         { label: 'Activo',      color: 'var(--color-success)' },
  paused:         { label: 'Pausado',     color: 'var(--color-text-mute)' },
  sold:           { label: 'Vendido',     color: 'var(--color-info)' },
  rejected:       { label: 'Rechazado',   color: 'var(--color-danger)' },
};

export function MyListingsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const mineQ = useQuery({
    queryKey: ['market', 'mine'],
    queryFn: () => marketApi.listMine(),
  });

  const pauseMut = useMutation({
    mutationFn: (v: { id: string; pause: boolean }) => marketApi.pauseListing(v.id, v.pause),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['market', 'mine'] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => marketApi.deleteListing(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['market', 'mine'] }),
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
            <Package size={20} />
          </span>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Mis lotes</h1>
            <p className="text-sm" style={{ color: 'var(--color-text-mute)' }}>
              Gestiona tu inventario verificado.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="cv-btn cv-btn-primary"
        >
          {showForm ? <><X size={16} /> Cerrar formulario</> : <><Plus size={16} /> Crear lote</>}
        </button>
      </header>

      {showForm ? <CreateListingForm onCreated={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['market', 'mine'] }); }} /> : null}

      {mineQ.isLoading ? (
        <div className="space-y-2">
          {[1,2,3].map((i) => <div key={i} className="cv-skeleton h-20" />)}
        </div>
      ) : (mineQ.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Package size={40} strokeWidth={1.5} />}
          title="Aún no tienes lotes publicados"
          description="Crea tu primer lote a partir de un análisis verificado."
        />
      ) : (
        <ul className="space-y-3">
          {mineQ.data!.map((l) => {
            const s = STATUS_LABEL[l.status];
            return (
              <li key={l.id} className="cv-card cv-card-hover p-4 flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to={`/marketplace/${l.id}`} className="font-semibold hover:underline truncate">
                      {l.titulo}
                    </Link>
                    <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full text-white"
                          style={{ background: s.color }}>
                      {s.label}
                    </span>
                  </div>
                  <p className="text-sm mt-1 capitalize" style={{ color: 'var(--color-text-soft)' }}>
                    {l.variedad} · {l.proceso} · {l.cantidad_kg} kg · <strong>${l.precio_kg_cop.toLocaleString()}/kg</strong>
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {l.status === 'pending_review' && (
                      <span className="cv-chip cv-chip-warning">
                        <Clock size={12} /> Esperando revisión
                      </span>
                    )}
                    {l.status === 'active' && l.quality_score != null && (
                      <span className="cv-chip cv-chip-success">
                        <ShieldCheck size={12} /> Score {l.quality_score.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {(l.status === 'active' || l.status === 'paused') && (
                    <button onClick={() => pauseMut.mutate({ id: l.id, pause: l.status === 'active' })}
                            className="cv-btn cv-btn-outline cv-btn-sm"
                            title={l.status === 'active' ? 'Pausar' : 'Reactivar'}>
                      {l.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                  )}
                  <button onClick={() => { if (confirm('¿Eliminar este lote?')) deleteMut.mutate(l.id); }}
                          className="cv-btn cv-btn-sm"
                          style={{ background: '#FCD7D5', color: 'var(--color-danger)' }}
                          title="Eliminar">
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface FormState {
  analysisId: string;
  titulo: string;
  descripcion: string;
  variedad: string;
  proceso: ListingProcess;
  cantidadKg: number;
  precioKgCop: number;
  fechaCosecha: string;
}

function CreateListingForm({ onCreated }: { onCreated: () => void }) {
  const [s, setS] = useState<FormState>({
    analysisId: '',
    titulo: '',
    descripcion: '',
    variedad: '',
    proceso: 'lavado',
    cantidadKg: 50,
    precioKgCop: 25000,
    fechaCosecha: '',
  });
  const [error, setError] = useState<string | null>(null);

  const analysesQ = useQuery({
    queryKey: ['analysis', 'list-for-listing'],
    queryFn: () => analysisApi.list({ limit: 50 }),
  });

  const completed = (analysesQ.data?.items ?? []).filter((a) => a.status === 'completed' && a.overallScore !== null);
  const selected = completed.find((a) => a.id === s.analysisId);

  const createMut = useMutation({
    mutationFn: () => marketApi.createListing({
      titulo: s.titulo,
      descripcion: s.descripcion || null,
      variedad: s.variedad,
      proceso: s.proceso,
      cantidadKg: s.cantidadKg,
      precioKgCop: s.precioKgCop,
      fecha_cosecha: s.fechaCosecha || null,
      // El backend asociará analysisId si está soportado en su schema.
      ...(s.analysisId ? { analysis_id: s.analysisId } as unknown as Partial<Listing> : {}),
    }),
    onSuccess: () => onCreated(),
    onError: (e: unknown) => {
      const apiErr = e instanceof ApiError ? e : null;
      setError(apiErr?.message ?? 'No se pudo crear el lote.');
    },
  });

  return (
    <section className="cv-card p-5 space-y-4 cv-fade-in">
      <h2 className="font-semibold text-lg">Nuevo lote</h2>
      <div>
        <label className="cv-label">Análisis base (obligatorio para verificación)</label>
        {analysesQ.isLoading ? (
          <div className="cv-skeleton h-10" />
        ) : completed.length === 0 ? (
          <div className="cv-card p-3 flex items-start gap-2 text-sm"
               style={{ borderColor: 'var(--color-warning)', background: '#FFF8EC', color: 'var(--color-warning)' }}>
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            No tienes análisis completados. Realiza un análisis antes de publicar.
          </div>
        ) : (
          <select
            value={s.analysisId}
            onChange={(e) => setS({ ...s, analysisId: e.target.value })}
            className="cv-input"
          >
            <option value="">Selecciona un análisis…</option>
            {completed.map((a) => (
              <option key={a.id} value={a.id}>
                {new Date(a.capturedAt).toLocaleDateString()} · score {a.overallScore?.toFixed(1)} · {a.grainType}
              </option>
            ))}
          </select>
        )}
        {selected && (
          <p className="text-xs mt-2 px-3 py-2 rounded-lg"
             style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
            <ShieldCheck size={12} className="inline mr-1 -mt-0.5" />
            Score: <strong>{selected.overallScore?.toFixed(1)}</strong>. Se copiará como <code>quality_score</code> tras la revisión admin.
          </p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Título"   value={s.titulo}      onChange={(v) => setS({ ...s, titulo: v })} />
        <Field label="Variedad" value={s.variedad}    onChange={(v) => setS({ ...s, variedad: v })} />
        <div>
          <label className="cv-label">Proceso</label>
          <select
            value={s.proceso}
            onChange={(e) => setS({ ...s, proceso: e.target.value as ListingProcess })}
            className="cv-input"
          >
            <option value="lavado">Lavado</option>
            <option value="natural">Natural</option>
            <option value="honey">Honey</option>
            <option value="anaerobic">Anaeróbico</option>
          </select>
        </div>
        <Field label="Fecha de cosecha" type="date" value={s.fechaCosecha} onChange={(v) => setS({ ...s, fechaCosecha: v })} />
        <Field label="Cantidad (kg)" type="number" value={String(s.cantidadKg)} onChange={(v) => setS({ ...s, cantidadKg: Math.max(1, Number(v) || 0) })} />
        <Field label="Precio por kg (COP)" type="number" value={String(s.precioKgCop)} onChange={(v) => setS({ ...s, precioKgCop: Math.max(0, Number(v) || 0) })} />
      </div>
      <div>
        <label className="cv-label">Descripción</label>
        <textarea
          rows={3} value={s.descripcion}
          placeholder="Notas de finca, altitud, perfil sensorial…"
          onChange={(e) => setS({ ...s, descripcion: e.target.value })}
          className="cv-input"
        />
      </div>
      {error && (
        <p className="text-sm flex items-center gap-1" style={{ color: 'var(--color-danger)' }}>
          <AlertCircle size={14} /> {error}
        </p>
      )}
      <button
        onClick={() => { setError(null); createMut.mutate(); }}
        disabled={createMut.isPending || !s.titulo || !s.variedad}
        className="cv-btn cv-btn-primary w-full sm:w-auto"
      >
        {createMut.isPending ? 'Creando…' : 'Crear lote'}
      </button>
    </section>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="cv-label">{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="cv-input"
      />
    </div>
  );
}
