/**
 * lib/api/queryClient.ts — TanStack Query configurado para CaféVision.
 *
 * staleTime conservador (30s) para datos volátiles, cache 5 min.
 * Retry deshabilitado para 4xx; sólo reintenta errores de red/5xx.
 */
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, err) => {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
