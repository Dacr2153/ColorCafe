/**
 * lib/ws/useAnalysisLive.ts — Hook que suscribe a eventos en vivo del análisis.
 *
 * Conexión WebSocket autenticada con JWT en la query. Resub al reconnect.
 */
import { useEffect, useRef, useState } from 'react';
import { config } from '../config';
import { getAuthSnapshot } from '../auth/store';

export type LiveEvent =
  | { type: 'analysis.progress'; payload: { analysisId: string; stage: string; pct?: number } }
  | { type: 'analysis.completed'; payload: { analysisId: string; overallScore: number } }
  | { type: 'analysis.failed'; payload: { analysisId: string; error: string } }
  | { type: 'order.message'; payload: { orderId: string; senderId: string; mensaje: string; createdAt: string } }
  | { type: 'order.status_changed'; payload: { orderId: string; status: string } };

export function useLiveTopic(topic: string | null, onEvent: (e: LiveEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!topic) return;
    const { accessToken } = getAuthSnapshot();
    if (!accessToken) return;

    let cancelled = false;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const connect = (): void => {
      if (cancelled) return;
      const url = `${config.wsUrl}?token=${encodeURIComponent(accessToken)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.addEventListener('open', () => {
        setConnected(true);
        attempt = 0;
        ws.send(JSON.stringify({ action: 'subscribe', topic }));
      });
      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { type?: string; payload?: unknown };
          if (msg.type && msg.payload !== undefined) {
            handlerRef.current({ type: msg.type, payload: msg.payload } as LiveEvent);
          }
        } catch {
          // ignore malformed
        }
      });
      ws.addEventListener('close', () => {
        setConnected(false);
        if (cancelled) return;
        attempt += 1;
        const delay = Math.min(30_000, 1000 * Math.pow(2, attempt));
        reconnectTimer = window.setTimeout(connect, delay);
      });
      ws.addEventListener('error', () => {
        try { ws.close(); } catch { /* noop */ }
      });
    };
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      try { wsRef.current?.close(); } catch { /* noop */ }
    };
  }, [topic]);

  return { connected };
}
