/**
 * features/marketplace/ListingDetailPage.tsx — Detalle de lote + creación de
 * orden por parte del comprador.
 *
 * Reglas:
 *  - El `quality_score` se muestra tal cual viene del backend, junto a un badge
 *    "Verificado" si y sólo si `status='active'` (revisado por admin).
 *  - El comprador NO puede comprarse a sí mismo (validado en backend, pero
 *    también ocultamos botón en frontend).
 */
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { marketApi } from '../../lib/api/endpoints/market';
import { useAuthStore } from '../../lib/auth/store';
import { scoreColorVar, scoreLabel } from '../../lib/design/score';
import { Disclaimer } from '../../components/common/Disclaimer';
import { CheckCircle2, AlertCircle, ArrowLeft, Coffee, MapPin, Calendar, Package, Loader2 } from 'lucide-react';
import { ApiError } from '../../lib/api/client';

export function ListingDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [cantidadKg, setCantidadKg] = useState<number>(1);
  const [notas, setNotas] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listingQ = useQuery({
    queryKey: ['market', 'listing', id],
    queryFn: () => marketApi.getListing(id),
    enabled: !!id,
  });
  const l = listingQ.data;

  async function placeOrder() {
    if (!l) return;
    setSubmitting(true); setError(null);
    try {
      const order = await marketApi.createOrder(l.id, cantidadKg, notas || undefined);
      navigate(`/marketplace/orders/${order.id}`);
    } catch (e) {
      const apiErr = e instanceof ApiError ? e : null;
      setError(apiErr?.message ?? 'No se pudo crear la orden.');
    } finally {
      setSubmitting(false);
    }
  }

  if (listingQ.isLoading) return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="cv-skeleton h-4 w-32" />
      <div className="grid md:grid-cols-2 gap-4">
        <div className="cv-skeleton h-72" />
        <div className="space-y-3">
          <div className="cv-skeleton h-8 w-3/4" />
          <div className="cv-skeleton h-4 w-full" />
          <div className="cv-skeleton h-12 w-32" />
        </div>
      </div>
    </div>
  );
  if (listingQ.isError || !l) return (
    <div className="p-6 max-w-2xl mx-auto cv-card text-center space-y-3">
      <span className="w-12 h-12 mx-auto rounded-full flex items-center justify-center"
            style={{ background: '#FCD7D5', color: 'var(--color-danger)' }}>
        <AlertCircle size={22} />
      </span>
      <p>Lote no disponible o has perdido el acceso.</p>
      <Link to="/marketplace" className="cv-btn cv-btn-primary inline-flex">
        <ArrowLeft size={14} /> Volver al marketplace
      </Link>
    </div>
  );

  const isOwn  = user?.id === l.producer_id;
  const verified = l.status === 'active' && l.quality_score !== null;
  const total = (cantidadKg || 0) * l.precio_kg_cop;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      <Link to="/marketplace" className="cv-btn cv-btn-ghost cv-btn-sm w-fit">
        <ArrowLeft size={14} /> Marketplace
      </Link>

      <div className="grid md:grid-cols-5 gap-5">
        <div className="cv-card overflow-hidden md:col-span-2">
          {l.fotos && l.fotos.length > 0 ? (
            <img src={l.fotos[0]} alt={l.titulo} className="w-full h-80 md:h-full object-cover" />
          ) : (
            <div className="w-full h-80 flex items-center justify-center"
                 style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-mute)' }}>
              <Coffee size={48} strokeWidth={1.5} />
            </div>
          )}
        </div>
        <div className="space-y-4 md:col-span-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{l.titulo}</h1>
            <p className="mt-2" style={{ color: 'var(--color-text-soft)' }}>{l.descripcion ?? 'Sin descripción.'}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-baseline gap-2 px-3 py-1.5 rounded-2xl font-bold"
                  style={{ background: scoreColorVar(l.quality_score), color: '#fff' }}>
              <span className="text-2xl tabular-nums">
                {l.quality_score != null ? l.quality_score.toFixed(1) : '—'}
              </span>
              <span className="text-xs uppercase tracking-wide opacity-90">
                {scoreLabel(l.quality_score)}
              </span>
            </span>
            {verified && (
              <span className="cv-chip cv-chip-success">
                <CheckCircle2 size={12} /> Verificado
              </span>
            )}
            <span className="cv-chip cv-chip-primary capitalize">{l.proceso}</span>
            <span className="cv-chip cv-chip-accent">{l.variedad}</span>
          </div>

          <div className="cv-card p-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Field icon={<Package size={14} />}  label="Disponible" value={`${l.cantidad_kg} kg`} />
            <Field icon={<Coffee size={14} />}   label="Precio"     value={`$${l.precio_kg_cop.toLocaleString()}/kg`} />
            <Field icon={<MapPin size={14} />}   label="Origen"
                   value={[l.municipio, l.departamento].filter(Boolean).join(', ') || '—'} />
            {l.puntuacion_taza != null && (
              <Field icon={<CheckCircle2 size={14} />} label="Puntuación taza" value={l.puntuacion_taza.toString()} />
            )}
            {l.fecha_cosecha && (
              <Field icon={<Calendar size={14} />} label="Cosecha"
                     value={new Date(l.fecha_cosecha).toLocaleDateString()} />
            )}
          </div>
        </div>
      </div>

      <Disclaimer extra="El score proviene de un análisis automatizado; recomendamos verificación con catación física certificada antes de cerrar la compra." />

      {!user ? (
        <div className="cv-card p-5 text-center">
          <p className="mb-3" style={{ color: 'var(--color-text-soft)' }}>
            Inicia sesión para comprar este lote.
          </p>
          <Link to="/login" className="cv-btn cv-btn-primary inline-flex">Iniciar sesión</Link>
        </div>
      ) : isOwn ? (
        <div className="cv-card p-4 flex items-start gap-2 text-sm"
             style={{ color: 'var(--color-text-soft)' }}>
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          Este es tu propio lote. Para gestionarlo ve a tus lotes.
        </div>
      ) : l.status !== 'active' ? (
        <div className="cv-card p-4 flex items-center gap-2 text-sm"
             style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}>
          <AlertCircle size={16} /> Este lote no está disponible para compra (estado: {l.status}).
        </div>
      ) : (
        <section className="cv-card p-5 space-y-4">
          <h2 className="font-semibold text-lg">Crear orden</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="cv-label">Cantidad (kg)</label>
              <input
                type="number" min={1} max={l.cantidad_kg} inputMode="numeric"
                value={cantidadKg}
                onChange={(e) => setCantidadKg(Math.max(1, Math.min(l.cantidad_kg, Number(e.target.value) || 1)))}
                className="cv-input"
              />
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-mute)' }}>
                Máximo {l.cantidad_kg} kg disponibles.
              </p>
            </div>
            <div>
              <label className="cv-label">Total estimado</label>
              <div className="cv-input flex items-center font-bold tabular-nums"
                   style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
                ${total.toLocaleString()} COP
              </div>
            </div>
          </div>
          <div>
            <label className="cv-label">Notas de negociación (opcional)</label>
            <textarea
              value={notas} onChange={(e) => setNotas(e.target.value)} rows={3}
              placeholder="Cuéntale al productor lo que esperas: forma de pago, logística, certificaciones…"
              className="cv-input"
            />
          </div>
          {error && (
            <p className="text-sm flex items-center gap-1" style={{ color: 'var(--color-danger)' }}>
              <AlertCircle size={14} /> {error}
            </p>
          )}
          <button
            onClick={placeOrder} disabled={submitting}
            className="cv-btn cv-btn-primary cv-btn-lg w-full"
          >
            {submitting ? <><Loader2 size={16} className="animate-spin" /> Enviando…</> : 'Crear orden'}
          </button>
        </section>
      )}
    </div>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-xs uppercase tracking-wide mb-0.5"
          style={{ color: 'var(--color-text-mute)' }}>
        <span style={{ color: 'var(--color-primary)' }}>{icon}</span> {label}
      </dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
