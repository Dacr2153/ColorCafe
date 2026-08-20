/**
 * lib/AppProviders.tsx — Composición de providers de la nueva arquitectura.
 *
 * Uso desde main.tsx (o desde App.tsx envolviendo lo existente):
 *
 *   <AppProviders>
 *     <App />
 *   </AppProviders>
 *
 * Coexiste con el Redux <Provider> legado: el árbol Redux sigue funcionando
 * para las pantallas antiguas mientras las nuevas pantallas adoptan TanStack
 * Query + Zustand.
 */
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from './api/queryClient';

interface Props {
  children: ReactNode;
  /** Si false, oculta devtools incluso en dev. */
  enableDevtools?: boolean;
}

export function AppProviders({ children, enableDevtools = true }: Props) {
  const showDevtools = enableDevtools && import.meta.env.DEV;
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {showDevtools ? <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" /> : null}
    </QueryClientProvider>
  );
}
