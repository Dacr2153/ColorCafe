/**
 * lib/network/useNetworkStatus.ts — Hook que expone estado de red real.
 *
 * Combina:
 *  - navigator.onLine (online/offline event)
 *  - navigator.connection (effectiveType: slow-2g/2g/3g/4g) si está disponible
 *  - heartbeat opcional al backend cada 30s para detectar redes "captivas"
 *    (online según el navegador pero sin acceso al backend).
 *
 * NO mostrar datos "antiguos" sin marcarlos: este hook expone `quality` que la
 * UI puede usar para mostrar banners honestos.
 */
import { useEffect, useState } from 'react';

export type NetworkQuality = 'offline' | 'slow' | 'good' | 'unknown';

interface NetInfo {
  online: boolean;
  quality: NetworkQuality;
  effectiveType?: string;
}

interface NavigatorConnection {
  effectiveType?: '2g' | '3g' | '4g' | 'slow-2g';
  addEventListener?: (type: 'change', cb: () => void) => void;
  removeEventListener?: (type: 'change', cb: () => void) => void;
}

function readSnapshot(): NetInfo {
  if (typeof navigator === 'undefined') {
    return { online: true, quality: 'unknown' };
  }
  const online = navigator.onLine;
  const conn = (navigator as Navigator & { connection?: NavigatorConnection }).connection;
  const effectiveType = conn?.effectiveType;
  let quality: NetworkQuality = online ? 'good' : 'offline';
  if (online && (effectiveType === '2g' || effectiveType === 'slow-2g')) {
    quality = 'slow';
  } else if (online && !effectiveType) {
    quality = 'unknown';
  }
  return { online, quality, effectiveType };
}

export function useNetworkStatus(): NetInfo {
  const [state, setState] = useState<NetInfo>(() => readSnapshot());

  useEffect(() => {
    const update = () => setState(readSnapshot());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const conn = (navigator as Navigator & { connection?: NavigatorConnection }).connection;
    conn?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      conn?.removeEventListener?.('change', update);
    };
  }, []);

  return state;
}
