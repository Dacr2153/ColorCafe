/**
 * features/home/Dashboard.tsx — Dashboard del usuario autenticado.
 *
 * Muestra KPIs y actividad reciente. Si no hay datos, muestra EmptyState
 * — JAMÁS se rellena con cifras inventadas.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Camera, BarChart3, Store, ArrowRight, Coffee, Sprout, ShoppingBag, Plus,
} from 'lucide-react';
import { useAuthStore } from '../../lib/auth/store';
import { metricsApi } from '../../lib/api/endpoints/metrics';
import { analysisApi } from '../../lib/api/endpoints/analysis';
import { farmerApi } from '../../lib/api/endpoints/farmer';
import { EmptyState } from '../../components/common/EmptyState';
import { scoreColorVar, scoreLabel } from '../../lib/design/score';

export function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const isProducer = user?.role === 'producer';

  const summary = useQuery({
    queryKey: ['metrics', 'summary'],
    queryFn: () => metricsApi.summary(),
    enabled: isProducer,
  });

  const recent = useQuery({
    queryKey: ['analyses', 'recent'],
    queryFn: () => analysisApi.list({ limit: 5 }),
    enabled: isProducer,
  });

  const farms = useQuery({
    queryKey: ['farms', 'mine'],
    queryFn: () => farmerApi.listFarms(),
    enabled: isProducer,
  });

  return (
    <div className="max-w-[var(--max-w)] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Saludo */}
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm" style={{ color: 'var(--color-text-mute)' }}>
            {greeting()} 👋
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-0.5">
            {user?.nombre || 'Usuario'}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-soft)' }}>
            {isProducer
              ? 'Aquí está el resumen de tu actividad.'
              : 'Explora lotes verificados y conecta con productores.'}
          </p>
        </div>
        {isProducer && (
          <Link to="/capture" className="cv-btn cv-btn-primary">
            <Camera size={18} /> Nuevo análisis
          </Link>
        )}
      </header>

      {/* KPIs del productor */}
      {isProducer ? (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            icon={<Coffee size={18} />}
            label="Análisis totales"
            value={summary.data?.total ?? null}
            loading={summary.isLoading}
          />
          <Kpi
            icon={<Sprout size={18} />}
            label="Completados"
            value={summary.data?.completed ?? null}
            loading={summary.isLoading}
          />
          <Kpi
            icon={<BarChart3 size={18} />}
            label="Score promedio"
            value={summary.data?.avgScore != null ? summary.data.avgScore.toFixed(1) : null}
            loading={summary.isLoading}
          />
          <Kpi
            icon={<Sprout size={18} />}
            label="Mis fincas"
            value={farms.data?.length ?? null}
            loading={farms.isLoading}
          />
        </section>
      ) : (
        <BuyerWelcome />
      )}

      {/* Acciones rápidas */}
      <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {isProducer && (
          <>
            <ActionCard
              to="/capture"
              icon={<Camera />}
              title="Analizar muestra"
              desc="Sube una foto y obtén el análisis."
              tone="primary"
            />
            <ActionCard
              to="/metrics"
              icon={<BarChart3 />}
              title="Mis métricas"
              desc="Evolución por período y finca."
            />
            <ActionCard
              to="/marketplace/mine"
              icon={<Store />}
              title="Mis lotes"
              desc="Publica y gestiona tus lotes."
            />
          </>
        )}
        {!isProducer && (
          <>
            <ActionCard
              to="/marketplace"
              icon={<Store />}
              title="Marketplace"
              desc="Lotes verificados disponibles."
              tone="primary"
            />
            <ActionCard
              to="/marketplace/orders"
              icon={<ShoppingBag />}
              title="Mis pedidos"
              desc="Estado de tus órdenes."
            />
          </>
        )}
      </section>

      {/* Recientes (solo productor) */}
      {isProducer && (
        <section className="cv-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Análisis recientes</h2>
            <Link to="/metrics" className="text-sm" style={{ color: 'var(--color-primary)' }}>
              Ver todo →
            </Link>
          </div>
          {recent.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="cv-skeleton h-12" />)}
            </div>
          ) : recent.data?.items.length ? (
            <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {recent.data.items.map((a) => (
                <li key={a.id} className="py-3 flex items-center gap-3">
                  <span className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
                    <Coffee size={18} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      Muestra {a.grainType}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--color-text-mute)' }}>
                      {formatDate(a.capturedAt)} · {a.status}
                    </div>
                  </div>
                  {a.overallScore != null ? (
                    <span className="cv-chip" style={{
                      background: scoreColorVar(a.overallScore),
                      color: '#fff', borderColor: 'transparent',
                    }}>
                      {a.overallScore.toFixed(0)} · {scoreLabel(a.overallScore)}
                    </span>
                  ) : (
                    <span className="cv-chip">—</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Camera size={40} strokeWidth={1.5} />}
              title="Aún no tienes análisis"
              description="Haz tu primer análisis para verlo aquí."
              action={
                <Link to="/capture" className="cv-btn cv-btn-primary">
                  <Plus size={16} /> Primer análisis
                </Link>
              }
            />
          )}
        </section>
      )}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6)  return 'Madrugando';
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch { return iso; }
}

interface KpiProps { icon: React.ReactNode; label: string; value: string | number | null; loading?: boolean; }
function Kpi({ icon, label, value, loading }: KpiProps) {
  return (
    <div className="cv-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide"
           style={{ color: 'var(--color-text-mute)' }}>
        <span>{icon}</span> {label}
      </div>
      <div className="mt-2 text-2xl font-bold">
        {loading ? <span className="cv-skeleton inline-block w-12 h-7 align-middle" /> :
          value !== null && value !== '' ? value : '—'}
      </div>
    </div>
  );
}

interface ActionCardProps {
  to: string; icon: React.ReactNode; title: string; desc: string; tone?: 'primary' | 'default';
}
function ActionCard({ to, icon, title, desc, tone = 'default' }: ActionCardProps) {
  const primary = tone === 'primary';
  return (
    <Link
      to={to}
      className="cv-card cv-card-hover p-5 block group"
      style={{
        textDecoration: 'none',
        background: primary ? 'var(--color-primary)' : 'var(--color-surface)',
        color: primary ? '#fff' : 'inherit',
        borderColor: primary ? 'transparent' : 'var(--color-border)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
             style={{
               background: primary ? 'rgba(255,255,255,0.15)' : 'var(--color-primary-soft)',
               color: primary ? '#fff' : 'var(--color-primary)',
             }}>
          {icon}
        </div>
        <ArrowRight size={18} className="opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
      </div>
      <h3 className="font-semibold mt-3">{title}</h3>
      <p className="text-sm mt-1" style={{ color: primary ? 'rgba(255,255,255,0.85)' : 'var(--color-text-mute)' }}>
        {desc}
      </p>
    </Link>
  );
}

function BuyerWelcome() {
  return (
    <section className="cv-card p-5 sm:p-6 cv-hero-bg" style={{ borderColor: 'transparent' }}>
      <h2 className="text-lg font-semibold">Encuentra el café perfecto</h2>
      <p className="text-sm mt-1 max-w-md" style={{ color: 'var(--color-text-soft)' }}>
        Cada lote en el marketplace tiene un análisis verificado.
        Puedes filtrar por proceso, score y origen.
      </p>
      <Link to="/marketplace" className="cv-btn cv-btn-primary mt-4">
        Explorar lotes <ArrowRight size={16} />
      </Link>
    </section>
  );
}
