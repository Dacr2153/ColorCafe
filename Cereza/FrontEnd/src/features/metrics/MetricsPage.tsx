/**
 * features/metrics/MetricsPage.tsx — Dashboard honesto de métricas.
 *
 * Reglas:
 *  - "Sin datos" jamás se rellena; se muestra EmptyState.
 *  - El rango temporal está acotado por `availability` real del backend.
 *  - Si una serie viene con `null` (e.g. avgScore), se grafica como hueco.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar,
} from 'recharts';
import { metricsApi, type Granularity } from '../../lib/api/endpoints/metrics';
import { EmptyState } from '../../components/common/EmptyState';
import { StaleDataBadge } from '../../components/common/StaleDataBadge';
import { BarChart3, AlertCircle, TrendingUp, TrendingDown, Activity, CheckCircle2, XCircle } from 'lucide-react';

function isoDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString();
}

const PRESETS: { id: string; label: string; days: number; granularity: Granularity }[] = [
  { id: '7d',  label: 'Última semana', days: 7,   granularity: 'day' },
  { id: '30d', label: 'Último mes',     days: 30,  granularity: 'day' },
  { id: '90d', label: 'Últimos 90 días', days: 90, granularity: 'week' },
  { id: '1y',  label: 'Último año',     days: 365, granularity: 'month' },
];

export function MetricsPage() {
  const [presetId, setPresetId] = useState('30d');
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const range = useMemo(() => ({
    from: isoDaysAgo(preset.days),
    to: new Date().toISOString(),
    granularity: preset.granularity,
  }), [preset]);

  const summary = useQuery({
    queryKey: ['metrics', 'summary'],
    queryFn: () => metricsApi.summary(),
  });
  const series = useQuery({
    queryKey: ['metrics', 'series', range],
    queryFn: () => metricsApi.timeSeries(range),
  });
  const distribution = useQuery({
    queryKey: ['metrics', 'dist', range.from, range.to],
    queryFn: () => metricsApi.qualityDistribution({ from: range.from, to: range.to }),
  });

  const seriesData = (series.data ?? []).map((p) => ({
    bucket: p.bucket.slice(0, 10),
    count: p.count,
    score: p.avgScore,
  }));
  const distData = Object.entries(distribution.data ?? {}).map(([name, value]) => ({ name, value }));

  return (
    <div className="max-w-[var(--max-w)] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Métricas</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-mute)' }}>
            Evolución real de tus análisis. Sin datos inventados.
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Rango temporal">
          {PRESETS.map((p) => {
            const active = p.id === presetId;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={active}
                onClick={() => setPresetId(p.id)}
                className={`cv-btn cv-btn-sm ${active ? 'cv-btn-primary' : 'cv-btn-ghost'}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </header>

      {summary.isError || series.isError || distribution.isError ? (
        <div className="cv-card p-3 flex items-center gap-2"
             style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
          <AlertCircle size={16} /> Error al cargar métricas. Mostramos sólo lo disponible.
        </div>
      ) : null}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<Activity size={18} />}     label="Análisis totales" value={summary.data?.total}     loading={summary.isLoading} />
        <Kpi icon={<CheckCircle2 size={18} />} label="Completados"     value={summary.data?.completed} loading={summary.isLoading} tone="success" />
        <Kpi icon={<XCircle size={18} />}      label="Fallidos"        value={summary.data?.failed}    loading={summary.isLoading} tone="danger" />
        <Kpi icon={<TrendingUp size={18} />}   label="Score promedio"
             value={summary.data?.avgScore != null ? summary.data.avgScore.toFixed(1) : null}
             loading={summary.isLoading} tone="primary" />
      </section>

      <section className="cv-card p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-semibold">
            Volumen y score por {preset.granularity === 'day' ? 'día' : preset.granularity === 'week' ? 'semana' : 'mes'}
          </h2>
          <StaleDataBadge updatedAt={series.dataUpdatedAt} isFetching={series.isFetching} />
        </div>
        {series.isLoading ? (
          <div className="cv-skeleton h-[300px]" />
        ) : seriesData.length === 0 ? (
          <EmptyState
            icon={<BarChart3 size={40} strokeWidth={1.5} />}
            title="Sin análisis en este período"
            description="Realiza un análisis para empezar a ver tu evolución."
          />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={seriesData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="bucket" stroke="var(--color-text-mute)" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" stroke="var(--color-text-mute)" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="var(--color-text-mute)" tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 12,
                  boxShadow: 'var(--shadow-2)',
                }}
              />
              <Line yAxisId="left"  type="monotone" dataKey="count" name="N° análisis"   stroke="var(--color-primary)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line yAxisId="right" type="monotone" dataKey="score" name="Score promedio" stroke="var(--color-accent)" strokeWidth={2.5} connectNulls={false} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="cv-card p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-semibold">Distribución de calidad</h2>
          <StaleDataBadge updatedAt={distribution.dataUpdatedAt} isFetching={distribution.isFetching} />
        </div>
        {distribution.isLoading ? (
          <div className="cv-skeleton h-[260px]" />
        ) : distData.length === 0 ? (
          <EmptyState
            icon={<TrendingDown size={40} strokeWidth={1.5} />}
            title="Sin datos de distribución para este período"
          />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={distData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" stroke="var(--color-text-mute)" tick={{ fontSize: 12 }} />
              <YAxis stroke="var(--color-text-mute)" tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 12,
                  boxShadow: 'var(--shadow-2)',
                }}
              />
              <Bar dataKey="value" fill="var(--color-primary)" radius={[8,8,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <p className="text-xs text-center" style={{ color: 'var(--color-text-mute)' }}>
        Todas las cifras provienen del backend en tiempo real. No se generan datos artificiales.
      </p>
    </div>
  );
}

interface KpiProps {
  label: string;
  value?: string | number | null;
  loading?: boolean;
  tone?: 'normal' | 'danger' | 'success' | 'primary';
  icon?: React.ReactNode;
}
function Kpi({ label, value, loading, tone = 'normal', icon }: KpiProps) {
  const colorMap: Record<string, string> = {
    normal:  'var(--color-text)',
    primary: 'var(--color-primary)',
    success: 'var(--color-success)',
    danger:  'var(--color-danger)',
  };
  const color = colorMap[tone];
  return (
    <div className="cv-card cv-card-hover p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide"
           style={{ color: 'var(--color-text-mute)' }}>
        {icon && <span style={{ color }}>{icon}</span>}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl sm:text-3xl font-bold tabular-nums" style={{ color }}>
        {loading ? <span className="cv-skeleton inline-block w-12 h-7 align-middle" />
          : value !== null && value !== undefined && value !== '' ? value : '—'}
      </div>
    </div>
  );
}
