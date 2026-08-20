/**
 * lib/config.ts — Configuración pública del frontend.
 *
 * Solo valores no sensibles vía import.meta.env (VITE_*). Tokens, claves
 * privadas y demás NUNCA viven aquí.
 */

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)
  ?? (typeof window !== 'undefined'
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : 'http://localhost:3001');

const wsUrl = (import.meta.env.VITE_WS_URL as string | undefined)
  ?? baseUrl.replace(/^http/, 'ws') + '/ws';

export const config = Object.freeze({
  apiBaseUrl: baseUrl.replace(/\/$/, ''),
  apiVersion: 'v1',
  wsUrl,
  /** Versión de la app inyectada por Vite en build. */
  appVersion: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev',
});

export const apiUrl = (path: string): string =>
  `${config.apiBaseUrl}/api/${config.apiVersion}${path.startsWith('/') ? path : '/' + path}`;
