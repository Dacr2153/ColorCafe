/**
 * lib/api/endpoints/content.ts — Noticias y tips.
 */
import { http } from '../client';

export interface NewsItem {
  id: string;
  titulo: string;
  slug: string;
  resumen: string | null;
  contenido_html: string;
  categoria: string | null;
  fuente: string | null;
  fecha_publicacion: string;
  views: number;
}

export interface Tip {
  id: string;
  titulo: string;
  contenido: string;
  categoria: string | null;
  variedad: string | null;
  nivel_dificultad: 'basico' | 'intermedio' | 'avanzado' | null;
  altitud_msnm_min: number | null;
  altitud_msnm_max: number | null;
}

export interface NewsComment {
  id: string;
  news_id: string;
  parent_id: string | null;
  user_id: string;
  body: string;
  is_deleted: boolean;
  edited_at: string | null;
  created_at: string;
  user_nombre: string | null;
  user_role: string | null;
}

export const contentApi = {
  async listNews(params?: { search?: string; categoria?: string; limit?: number; offset?: number }) {
    const res = await http.get<{ items: NewsItem[]; total: number }>('/content/news', { params });
    return res.data;
  },
  async getNews(id: string) {
    const res = await http.get<{ article: NewsItem }>(`/content/news/${id}`);
    return res.data.article;
  },
  async aiSummary(id: string) {
    const res = await http.post<{ summary: string; model: string }>(`/content/news/${id}/ai-summary`);
    return res.data;
  },
  async listComments(newsId: string) {
    const res = await http.get<{ items: NewsComment[] }>(`/content/news/${newsId}/comments`);
    return res.data.items;
  },
  async createComment(newsId: string, body: string, parentId?: string | null) {
    const res = await http.post<{ comment: NewsComment }>(`/content/news/${newsId}/comments`, { body, parentId: parentId ?? null });
    return res.data.comment;
  },
  async deleteComment(commentId: string) {
    const res = await http.delete<{ ok: boolean }>(`/content/news/comments/${commentId}`);
    return res.data;
  },
  async listTips(params?: {
    categoria?: string;
    variedad?: string;
    nivelDificultad?: 'basico' | 'intermedio' | 'avanzado';
    altitudMsnm?: number;
    limit?: number;
    offset?: number;
  }) {
    const res = await http.get<{ items: Tip[] }>('/content/tips', { params });
    return res.data.items;
  },
};
