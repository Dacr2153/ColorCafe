/**
 * lib/api/endpoints/auth.ts — Endpoints de autenticación.
 *
 * Backend responde { user, tokens:{ accessToken, refreshToken } } — aquí
 * lo aplanamos a la forma que espera el store de Zustand.
 */
import { http } from '../client';
import type { AuthUser } from '../../auth/store';

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface BackendAuthResponse {
  user: AuthUser;
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessExpiresIn?: number;
    refreshExpiresIn?: number;
  };
}

export interface RegisterPayload {
  email: string;
  password: string;
  nombre: string;
  role: 'producer' | 'buyer';
  nombreEmpresa?: string;
  nit?: string;
}

function flatten(res: BackendAuthResponse): LoginResponse {
  return {
    user: res.user,
    accessToken: res.tokens.accessToken,
    refreshToken: res.tokens.refreshToken,
  };
}

export const authApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const res = await http.post<BackendAuthResponse>('/auth/login', { email, password });
    return flatten(res.data);
  },
  async register(payload: RegisterPayload): Promise<LoginResponse> {
    const res = await http.post<BackendAuthResponse>('/auth/register', payload);
    return flatten(res.data);
  },
  async me(): Promise<AuthUser> {
    const res = await http.get<{ user: AuthUser }>('/auth/me');
    return res.data.user;
  },
  async logout(refreshToken: string): Promise<void> {
    await http.post('/auth/logout', { refreshToken });
  },
};
