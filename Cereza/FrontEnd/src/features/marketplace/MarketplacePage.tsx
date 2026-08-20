/**
 * features/marketplace/MarketplacePage.tsx — Buscador público de lotes.
 *
 * Sólo lotes con `status='active'` que han sido REVISADOS por un administrador.
 * El `quality_score` viene del análisis original verificado; nunca lo edita el
 * productor manualmente.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, Coffee, Store, MapPin, Star } from 'lucide-react';
import { marketApi, type ListingProcess } from '../../lib/api/endpoints/market';
import { EmptyState } from '../../components/common/EmptyState';
import { scoreColorVar, scoreLabel } from '../../lib/design/score';

const PROCESS_OPTIONS: { id: '' | ListingProcess; label: string }[] = [
  { id: '',          label: 'Todos los procesos' },
  { id: 'lavado',    label: 'Lavado' },
  { id: 'natural',   label: 'Natural' },
  { id: 'honey',     label: 'Honey' },
  { id: 'anaerobic', label: 'Anaeróbico' },
];

export function MarketplacePage() {
  const [q, setQ] = useState('');
  const [proceso, setProceso] = useState<'' | ListingProcess>('');
  const [minScore, setMinScore] = useState<number | ''>('');

  const search = useQuery({
    queryKey: ['market', 'search', q, proceso, minScore],
    queryFn: () => marketApi.search({
      q: q || undefined,
      proceso: proceso || undefined,
      minScore: typeof minScore === 'number' ? minScore : undefined,
      limit: 24,
    }),
  });

  return (
    <div className="max-w-[var(--max-w)] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      <header className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
          <Store size={20} />
        </span>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Marketplace</h1>
          <p className="text-sm" style={{ color: 'var(--color-text-mute)' }}>
            Lotes verificados con análisis trazable.
          </p>
        </div>
      </header>

      <section className="cv-card p-4 sm:p-5 grid md:grid-cols-4 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="cv-label">Búsqueda</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--color-text-mute)' }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Variedad, finca, origen…"
              className="cv-input pl-9"
            />
          </div>
        </div>
        <div>
          <label className="cv-label">Proceso</label>
          <select
            value={proceso}
            onChange={(e) => setProceso(e.target.value as '' | ListingProcess)}
            className="cv-input"
          >
            {PROCESS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="cv-label">Score mínimo</label>
          <input
            type="number" min={0} max={100} inputMode="numeric"
            value={minScore}
            onChange={(e) => setMinScore(e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))))}
            placeholder="0–100"
            className="cv-input"
          />
        </div>
      </section>

      {search.isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map((i) => (
            <div key={i} className="cv-card overflow-hidden">
              <div className="cv-skeleton h-40 rounded-none" />
              <div className="p-3 space-y-2">
                <div className="cv-skeleton h-4 w-3/4" />
                <div className="cv-skeleton h-3 w-1/2" />
                <div className="cv-skeleton h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : search.data?.items.length === 0 ? (
        <EmptyState
          icon={<Coffee size={40} strokeWidth={1.5} />}
          title="Sin lotes con esos criterios"
          description="Prueba a relajar los filtros o vuelve más tarde."
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {search.data?.items.map((l) => (
            <Link
              key={l.id}
              to={`/marketplace/${l.id}`}
              className="cv-card cv-card-hover overflow-hidden block group"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className="relative">
                {l.fotos && l.fotos.length > 0 ? (
                  <img src={l.fotos[0]} alt={l.titulo}
                       className="w-full h-44 object-cover transition-transform duration-500 group-hover:scale-105"
                       loading="lazy" />
                ) : (
                  <div className="w-full h-44 flex items-center justify-center"
                       style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-mute)' }}>
                    <Coffee size={32} strokeWidth={1.5} />
                  </div>
                )}
                {l.quality_score != null && (
                  <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: scoreColorVar(l.quality_score), color: '#fff' }}>
                    <Star size={11} fill="currentColor" /> {l.quality_score.toFixed(1)}
                  </span>
                )}
              </div>
              <div className="p-4 space-y-1.5">
                <h3 className="font-semibold line-clamp-1">{l.titulo}</h3>
                <p className="text-sm capitalize" style={{ color: 'var(--color-text-mute)' }}>
                  {l.variedad} · {l.proceso}
                </p>
                <p className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-mute)' }}>
                  <MapPin size={11} />
                  {[l.municipio, l.departamento].filter(Boolean).join(', ') || 'Origen no especificado'}
                </p>
                <div className="flex items-baseline justify-between pt-2">
                  <span className="text-xs" style={{ color: 'var(--color-text-mute)' }}>
                    {scoreLabel(l.quality_score)}
                  </span>
                  <span className="font-bold text-base tabular-nums" style={{ color: 'var(--color-primary)' }}>
                    ${l.precio_kg_cop.toLocaleString()}<span className="text-xs font-medium" style={{ color: 'var(--color-text-mute)' }}>/kg</span>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
