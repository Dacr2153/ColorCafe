/**
 * components/common/UpdatePrompt.tsx — Notificación honesta de nueva versión PWA.
 *
 * Cuando vite-plugin-pwa detecta una versión nueva del Service Worker la
 * exponemos al usuario; jamás recargamos a la fuerza. El usuario decide.
 */
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onOfflineReady() {
        // intencionalmente silencioso: ya hay banner de red
      },
    });
    setUpdateSW(() => update);
  }, []);

  if (!needRefresh) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg shadow-lg p-4 flex flex-col gap-3"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-3)',
      }}
    >
      <div>
        <h4 className="font-medium" style={{ color: 'var(--color-text)' }}>
          Nueva versión disponible
        </h4>
        <p className="text-sm" style={{ color: 'var(--color-text-soft)' }}>
          Recarga para aplicar las últimas mejoras.
        </p>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => setNeedRefresh(false)}
          className="px-3 py-1.5 rounded text-sm"
          style={{ color: 'var(--color-text-soft)' }}
        >
          Después
        </button>
        <button
          onClick={() => updateSW?.(true)}
          className="px-3 py-1.5 rounded text-sm font-medium text-white"
          style={{ background: 'var(--color-primary)' }}
        >
          Recargar
        </button>
      </div>
    </div>
  );
}
