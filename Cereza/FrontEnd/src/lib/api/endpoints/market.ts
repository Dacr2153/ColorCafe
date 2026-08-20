/**
 * lib/api/endpoints/market.ts — Marketplace, búsqueda y órdenes.
 */
import { http } from '../client';

export type ListingProcess = 'lavado' | 'natural' | 'honey' | 'anaerobic';
export type ListingStatus  = 'pending_review' | 'active' | 'paused' | 'sold' | 'rejected';
export type OrderStatus    = 'pending' | 'accepted' | 'rejected' | 'in_transit' | 'delivered' | 'cancelled';

export interface Listing {
  id: string;
  producer_id: string;
  titulo: string;
  descripcion: string | null;
  variedad: string;
  proceso: ListingProcess;
  puntuacion_taza: number | null;
  cantidad_kg: number;
  precio_kg_cop: number;
  quality_score: number | null;
  status: ListingStatus;
  fotos: string[] | null;
  fecha_cosecha: string | null;
  disponible_desde: string | null;
  disponible_hasta: string | null;
  views_count: number;
  contacts_count: number;
  created_at: string;
  rank?: number;
  producer_nombre?: string | null;
  departamento?: string | null;
  municipio?: string | null;
}

export interface Order {
  id: string;
  buyer_id: string;
  producer_id: string;
  listing_id: string;
  listing_titulo: string;
  cantidad_kg: number;
  precio_total: number;
  status: OrderStatus;
  notas_negociacion: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderMessage {
  id: string;
  sender_id: string;
  mensaje: string;
  created_at: string;
}

export const marketApi = {
  // ────── listings ──────
  async createListing(input: Partial<Listing> & { titulo: string; variedad: string; proceso: ListingProcess; cantidadKg: number; precioKgCop: number }) {
    const res = await http.post<{ listing: Listing }>('/market/listings', input);
    return res.data.listing;
  },
  async listMine() {
    const res = await http.get<{ items: Listing[] }>('/market/listings/mine');
    return res.data.items;
  },
  async getListing(id: string) {
    const res = await http.get<{ listing: Listing }>(`/market/listings/${id}`);
    return res.data.listing;
  },
  async updateListing(id: string, patch: Partial<Listing>) {
    const res = await http.patch<{ listing: Listing }>(`/market/listings/${id}`, patch);
    return res.data.listing;
  },
  async deleteListing(id: string) {
    await http.delete(`/market/listings/${id}`);
  },
  async pauseListing(id: string, pause: boolean) {
    const res = await http.post<{ id: string; status: ListingStatus }>(`/market/listings/${id}/pause`, { pause });
    return res.data;
  },
  // ────── search (público) ──────
  async search(params: {
    q?: string;
    proceso?: ListingProcess;
    variedad?: string;
    minScore?: number;
    maxPrice?: number;
    limit?: number;
    offset?: number;
  }) {
    const res = await http.get<{ items: Listing[]; limit: number; offset: number }>(
      '/market/search',
      { params },
    );
    return res.data;
  },
  // ────── orders ──────
  async createOrder(listingId: string, cantidadKg: number, notas?: string) {
    const res = await http.post<{ order: Order }>('/market/orders', { listingId, cantidadKg, notas });
    return res.data.order;
  },
  async listOrders(role: 'buyer' | 'producer') {
    const res = await http.get<{ items: Order[] }>('/market/orders/mine', { params: { role } });
    return res.data.items;
  },
  async getOrder(id: string) {
    const res = await http.get<{ order: Order }>(`/market/orders/${id}`);
    return res.data.order;
  },
  async transitionOrder(id: string, status: Exclude<OrderStatus, 'pending'>) {
    const res = await http.post<{ id: string; status: OrderStatus }>(
      `/market/orders/${id}/transition`,
      { status },
    );
    return res.data;
  },
  async listMessages(orderId: string, opts?: { limit?: number; before?: string }) {
    const res = await http.get<{ messages: OrderMessage[] }>(`/market/orders/${orderId}/messages`, { params: opts });
    return res.data.messages;
  },
  async postMessage(orderId: string, mensaje: string) {
    const res = await http.post<{ message: OrderMessage }>(`/market/orders/${orderId}/messages`, { mensaje });
    return res.data.message;
  },
};
