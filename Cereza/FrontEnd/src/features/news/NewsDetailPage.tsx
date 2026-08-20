/**
 * features/news/NewsDetailPage.tsx — Detalle de noticia con resumen AI opcional.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Eye, Tag, Calendar, ExternalLink, Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { contentApi } from '../../lib/api/endpoints/content';
import { ApiError } from '../../lib/api/client';
import { useAuthStore, selectIsAuthenticated } from '../../lib/auth/store';
import { NewsComments } from './NewsComments';

export function NewsDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const isAuth = useAuthStore(selectIsAuthenticated);

  const { data: news, isLoading, error } = useQuery({
    queryKey: ['news', id],
    queryFn: () => contentApi.getNews(id),
    enabled: !!id,
  });

  const [summary, setSummary] = useState<string | null>(null);
  const summaryMut = useMutation({
    mutationFn: () => contentApi.aiSummary(id),
    onSuccess: (data) => setSummary(data.summary),
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <Link to="/news" className="inline-flex items-center gap-1 text-sm font-medium"
            style={{ color: 'var(--color-text-soft)' }}>
        <ArrowLeft size={16} /> Volver a noticias
      </Link>

      {isLoading && (
        <div className="cv-card p-6 space-y-3">
          <div className="cv-skeleton h-7 w-3/4" />
          <div className="cv-skeleton h-4 w-1/3" />
          <div className="cv-skeleton h-40 w-full" />
        </div>
      )}

      {error instanceof ApiError && (
        <div className="cv-card p-4 flex items-start gap-2"
             style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span className="text-sm">{error.message || 'No se encontró la noticia.'}</span>
        </div>
      )}

      {news && (
        <article className="cv-card p-6 cv-fade-in space-y-4">
          <header className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{news.titulo}</h1>
            <div className="flex flex-wrap items-center gap-3 text-xs"
                 style={{ color: 'var(--color-text-mute)' }}>
              <span className="inline-flex items-center gap-1">
                <Calendar size={12} />
                {new Date(news.fecha_publicacion).toLocaleDateString('es-CO', {
                  day: '2-digit', month: 'long', year: 'numeric',
                })}
              </span>
              <span className="inline-flex items-center gap-1"><Eye size={12} /> {news.views}</span>
              {news.categoria && (
                <span className="cv-chip-primary inline-flex items-center gap-1">
                  <Tag size={11} /> {news.categoria}
                </span>
              )}
              {news.fuente && (
                <span className="inline-flex items-center gap-1">
                  <ExternalLink size={12} /> {news.fuente}
                </span>
              )}
            </div>
          </header>

          {news.resumen && (
            <p className="text-base leading-relaxed font-medium"
               style={{ color: 'var(--color-text-soft)' }}>
              {news.resumen}
            </p>
          )}

          {isAuth && (
            <div className="cv-card p-3"
                 style={{ background: 'var(--color-primary-soft)', borderColor: 'transparent' }}>
              {!summary ? (
                <button
                  type="button"
                  onClick={() => summaryMut.mutate()}
                  disabled={summaryMut.isPending}
                  className="cv-btn cv-btn-primary cv-btn-sm"
                >
                  {summaryMut.isPending
                    ? <><Loader2 size={14} className="animate-spin" /> Generando…</>
                    : <><Sparkles size={14} /> Resumen IA</>}
                </button>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs font-semibold inline-flex items-center gap-1"
                     style={{ color: 'var(--color-primary)' }}>
                    <Sparkles size={12} /> Resumen generado por IA
                  </p>
                  <p className="text-sm" style={{ color: 'var(--color-text)' }}>{summary}</p>
                </div>
              )}
              {summaryMut.error instanceof ApiError && (
                <p className="text-xs mt-2" style={{ color: 'var(--color-danger)' }}>
                  {summaryMut.error.message || 'No se pudo generar el resumen.'}
                </p>
              )}
            </div>
          )}

          <div
            className="prose prose-sm max-w-none news-content"
            style={{ color: 'var(--color-text)' }}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: news.contenido_html }}
          />
        </article>
      )}

      {news && <NewsComments newsId={news.id} />}
    </div>
  );
}
