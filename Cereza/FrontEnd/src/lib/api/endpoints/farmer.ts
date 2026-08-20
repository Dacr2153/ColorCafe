/**
 * lib/api/endpoints/farmer.ts — Perfil productor + fincas + cosechas.
 */
import { http } from '../client';

export interface ProducerProfile {
  user_id: string;
  nombre: string | null;
  departamento: string | null;
  municipio: string | null;
  telefono: string | null;
  bio: string | null;
}

export interface Farm {
  id: string;
  producer_id?: string;
  nombre_finca: string;
  tipo_suelo: string | null;
  ph_suelo: number | null;
  altitud_msnm: number | null;
  microclima: string | null;
  fecha_ultimo_analisis_suelo: string | null;
  geometria_poligono?: unknown;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

/** Payload aceptado por POST/PATCH /farmer/farms (camelCase, validado por backend). */
export interface FarmInput {
  nombreFinca: string;
  tipoSuelo?: string | null;
  phSuelo?: number | null;
  altitudMsnm?: number | null;
  microclima?: string | null;
  fechaUltimoAnalisisSuelo?: string | null;
  geometriaPoligono?: unknown;
}

export interface Harvest {
  id: string;
  farm_id: string;
  fecha_inicio: string;
  fecha_fin: string;
  cantidad_kg: number;
  variedad: string;
  notas: string | null;
}

export const farmerApi = {
  async getProfile() {
    const res = await http.get<{ profile: ProducerProfile }>('/farmer/profile');
    return res.data.profile;
  },
  async updateProfile(patch: Partial<ProducerProfile>) {
    const res = await http.patch<{ profile: ProducerProfile }>('/farmer/profile', patch);
    return res.data.profile;
  },
  async listFarms() {
    const res = await http.get<{ farms: Farm[] }>('/farmer/farms');
    return res.data?.farms ?? [];
  },
  async createFarm(input: FarmInput) {
    const res = await http.post<{ farm: Farm }>('/farmer/farms', input);
    return res.data.farm;
  },
  async getFarm(id: string) {
    const res = await http.get<{ farm: Farm }>(`/farmer/farms/${id}`);
    return res.data.farm;
  },
  async updateFarm(id: string, patch: Partial<FarmInput>) {
    const res = await http.patch<{ farm: Farm }>(`/farmer/farms/${id}`, patch);
    return res.data.farm;
  },
  async deactivateFarm(id: string) {
    await http.delete(`/farmer/farms/${id}`);
  },
  async listHarvests(farmId: string) {
    const res = await http.get<{ items: Harvest[] }>(`/farmer/farms/${farmId}/harvests`);
    return res.data.items;
  },
};
