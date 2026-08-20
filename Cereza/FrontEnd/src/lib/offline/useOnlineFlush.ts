/**
 * lib/offline/useOnlineFlush.ts — Drena la cola offline al recuperar conexión.
 *
 * Conecta `flushQueue` con `analysisApi.submit`. Honesto:
 *  - Si un item falla 5 veces queda visible para que el usuario decida.
 *  - NUNCA finge éxito.
 */
import { useEffect } from 'react';
import { analysisApi } from '../api/endpoints/analysis';
import { flushQueue, offlineQueue, type PendingAnalysis } from './queue';

export interface FlushResult {
  uploaded: number;
  pending: number;
}

async function uploadOne(item: PendingAnalysis): Promise<string> {
  const analysis = await analysisApi.submit({
    farmId: item.farmId,
    grainType: item.grainType,
    sampleWeightG: item.sampleWeightG,
    captureConditions: item.captureConditions,
    file: new File([item.blob], item.filename, { type: item.mime }),
  });
  return analysis.id;
}

export function useOnlineFlush(onResult?: (r: FlushResult) => void): void {
  useEffect(() => {
    let running = false;

    const run = async () => {
      if (running) return;
      running = true;
      try {
        const result = await flushQueue(uploadOne);
        onResult?.(result);
      } finally {
        running = false;
      }
    };

    // Disparar al montar (por si quedaron items de sesión anterior)
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void run();
    }
    const handler = () => { if (navigator.onLine) void run(); };
    window.addEventListener('online', handler);
    return () => window.removeEventListener('online', handler);
  }, [onResult]);
}

/** Versión imperativa para botón "Reintentar ahora". */
export async function manualFlush(): Promise<FlushResult> {
  return flushQueue(uploadOne);
}

export { offlineQueue };
