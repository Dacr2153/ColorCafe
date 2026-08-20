/**
 * lib/auth/store.ts — Auth state con Zustand + persistencia.
 *
 * Mantiene access token + refresh token + user. NUNCA persiste passwords.
 * El acceso al token desde el cliente HTTP es síncrono para evitar mutex.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type Role = 'admin' | 'producer' | 'buyer';

export interface AuthUser {
  id: string;
  email: string;
  nombre?: string | null;
  role: Role;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  setSession: (s: { accessToken: string; refreshToken: string; user: AuthUser }) => void;
  setAccessToken: (token: string) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: ({ accessToken, refreshToken, user }) =>
        set({ accessToken, refreshToken, user }),
      setAccessToken: (token) => set({ accessToken: token }),
      clear: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    {
      name: 'cafevision.auth.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        user: s.user,
      }),
    },
  ),
);

/** Lectura síncrona (útil para interceptores HTTP). */
export const getAuthSnapshot = () => useAuthStore.getState();

export const selectIsAuthenticated = (s: AuthState): boolean =>
  Boolean(s.accessToken && s.user);

export const selectRole = (s: AuthState): Role | null => s.user?.role ?? null;
