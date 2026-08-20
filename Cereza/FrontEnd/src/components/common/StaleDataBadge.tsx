/**
 * components/common/StaleDataBadge.tsx — Indicador visible cuando los datos
 * mostrados provienen de cache offline (no son frescos).
 *
 * Implementa la regla ética: el usuario siempre sabe si lo que ve es reciente
 * o histórico.
 */
import { Clock } from 'lucide-react';

interface Props {
  updatedAt?: Date | string | number | null;
  isFetching?: boolean;
  fromCache?: boolean;
}

function relative(ts: Date) {
  const diff = (Date.now() - ts.getTime()) / 1000;
  if (diff < 60) return 'hace segundos';
  if (diff < 3600) return `hace ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.round(diff / 3600)} h`;
  return ts.toLocaleDateString();
}

export function StaleDataBadge({ updatedAt, isFetching, fromCache }: Props) {
  if (!updatedAt && !fromCache) return null;
  const ts = updatedAt ? new Date(updatedAt) : null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
      style={{
        background: 'var(--color-surface-2)',
        color: 'var(--color-text-soft)',
      }}
      title={ts ? ts.toLocaleString() : undefined}
    >
      <Clock size={12} />
      {isFetching ? 'Actualizando…' : ts ? `Actualizado ${relative(ts)}` : 'Datos en caché'}
    </span>
  );
}
