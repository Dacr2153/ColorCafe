/**
 * components/common/NetworkBanner.tsx — Banda superior con el estado real de red.
 * Nunca oculta una caída de conexión: el usuario debe saber que sus envíos
 * podrían encolarse offline.
 */
import { useNetworkStatus } from '../../lib/network/useNetworkStatus';
import { WifiOff, AlertTriangle } from 'lucide-react';

export function NetworkBanner() {
  const { online, quality } = useNetworkStatus();
  if (online && quality === 'good') return null;

  const offline = !online;
  const label = offline
    ? 'Sin conexión — los análisis se guardarán y enviarán cuando vuelva la red.'
    : 'Conexión lenta — las operaciones pueden tardar más de lo habitual.';

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full px-4 py-2 text-sm flex items-center gap-2"
      style={{
        background: offline ? 'var(--color-danger)' : 'var(--color-warning)',
        color: '#fff',
      }}
    >
      {offline ? <WifiOff size={16} /> : <AlertTriangle size={16} />}
      <span>{label}</span>
    </div>
  );
}
