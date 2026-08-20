/**
 * lib/api/client.ts — Cliente HTTP central con refresh automático.
 *
 * Características:
 *  - Inyecta `Authorization: Bearer <access>` desde el store de auth.
 *  - Si recibe 401 en un endpoint protegido, intenta refresh una vez con un
 *    mutex (no múltiples refresh en paralelo) y reintenta la request original.
 *  - Si el refresh falla, limpia la sesión y propaga el error.
 *  - Mensajes de error normalizados a `ApiError` (code, message, status, details).
 *  - Backoff exponencial sólo para errores de red transitorios (no para 4xx).
 *
 * Política: NUNCA hace fallback a datos mock; los errores se propagan al
 * llamador para que la UI los muestre con honestidad.
 */
import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { config, apiUrl } from '../config';
import { getAuthSnapshot, useAuthStore } from '../auth/store';

export interface ApiErrorShape {
  error?: { code?: string; message?: string; details?: unknown };
  message?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromAxios(err: AxiosError<ApiErrorShape>): ApiError {
    const status = err.response?.status ?? 0;
    const data = err.response?.data;
    const code = data?.error?.code ?? (status === 0 ? 'network_error' : 'http_error');
    const message = data?.error?.message ?? data?.message ?? err.message ?? 'request_failed';
    return new ApiError(status, code, message, data?.error?.details);
  }
}

const RETRY_NETWORK_ERRORS = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET']);

interface RetryConfig extends InternalAxiosRequestConfig {
  _retryCount?: number;
  _refreshed?: boolean;
}

const MAX_NETWORK_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Mutex para refresh: si llegan N 401 en paralelo, sólo se ejecuta UNA llamada
// a /auth/refresh y las demás esperan el mismo resultado.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const { refreshToken } = getAuthSnapshot();
  if (!refreshToken) return null;
  refreshInFlight = (async () => {
    try {
      const res = await axios.post<{ tokens: { accessToken: string; refreshToken?: string } }>(
        apiUrl('/auth/refresh'),
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' } },
      );
      const newAccess = res.data.tokens?.accessToken;
      if (!newAccess) throw new Error('refresh_returned_no_token');
      const store = useAuthStore.getState();
      if (res.data.tokens.refreshToken) {
        store.setSession({
          accessToken: newAccess,
          refreshToken: res.data.tokens.refreshToken,
          user: store.user ?? ({} as never),  // user no cambia en refresh
        });
      } else {
        store.setAccessToken(newAccess);
      }
      return newAccess;
    } catch {
      useAuthStore.getState().clear();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export const http: AxiosInstance = axios.create({
  baseURL: `${config.apiBaseUrl}/api/${config.apiVersion}`,
  timeout: 20_000,
  headers: { Accept: 'application/json' },
});

http.interceptors.request.use((cfg) => {
  const { accessToken } = getAuthSnapshot();
  if (accessToken && !cfg.headers.Authorization) {
    cfg.headers.Authorization = `Bearer ${accessToken}`;
  }
  return cfg;
});

http.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<ApiErrorShape>) => {
    const original = err.config as RetryConfig | undefined;
    // Errores de red transitorios: retry con backoff
    if (!err.response && original) {
      const code = (err.code ?? '').toString();
      if (RETRY_NETWORK_ERRORS.has(code) || code === 'ERR_NETWORK') {
        original._retryCount = (original._retryCount ?? 0) + 1;
        if (original._retryCount <= MAX_NETWORK_RETRIES) {
          await sleep(300 * Math.pow(2, original._retryCount - 1));
          return http.request(original);
        }
      }
      throw ApiError.fromAxios(err);
    }
    // 401: intentar refresh una sola vez
    if (err.response?.status === 401 && original && !original._refreshed) {
      original._refreshed = true;
      const fresh = await refreshAccessToken();
      if (fresh) {
        original.headers.Authorization = `Bearer ${fresh}`;
        return http.request(original);
      }
    }
    throw ApiError.fromAxios(err);
  },
);

export type RequestConfig = AxiosRequestConfig;
