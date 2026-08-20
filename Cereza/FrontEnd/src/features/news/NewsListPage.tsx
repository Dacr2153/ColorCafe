/**
 * features/news/NewsListPage.tsx — Listado de noticias del café.
 */
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Newspaper, Search, AlertCircle, Tag, Eye, ArrowRight } from 'lucide-react';
import { contentApi, type NewsItem } from '../../lib/api/endpoints/content';
import { ApiError } from '../../lib/api/client';

export function NewsListPage() {
  const [search, setSearch] = useState('');
  const [categoria, setCategoria] = useState<string>('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['news', { search, categoria }],
    queryFn: () => contentApi.listNews({
      search: search.trim() || undefined,
      categoria: categoria || undefined,
      limit: 30,
    }),
  });

  const items = data?.items ?? [];
  const categorias = useMemo(() => {
    const s = new Set<string>();
    items.forEach((n) => { if (n.categoria) s.add(n.categoria); });
    return Array.from(s);
  }, [items]);

  return (
    <div className="max-w-[var(--max-w)] mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--color-primary)', color: '#fff' }}>
          <Newspaper size={22} />
        </span>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Noticias del café</h1>
          <p className="text-sm" style={{ color: 'var(--color-text-mute)' }}>
            Mercado, clima, normativa y buenas prácticas.
          </p>
        </div>
      </header>

      <div className="cv-card p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--color-text-mute)' }} />
          <input
            type="search"
            className="cv-input pl-9"
            placeholder="Buscar por título o resumen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {categorias.length > 0 && (
          <select className="cv-input sm:max-w-[200px]"
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {isLoading && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="cv-card p-4 space-y-3">
              <div className="cv-skeleton h-5 w-3/4" />
              <div className="cv-skeleton h-4 w-full" />
              <div className="cv-skeleton h-4 w-5/6" />
            </div>
          ))}
        </div>
      )}

      {error instanceof ApiError && (
        <div className="cv-card p-4 flex items-start gap-2"
             style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span className="text-sm">{error.message || 'No se pudieron cargar las noticias.'}</span>
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <div className="cv-card p-8 text-center"
             style={{ color: 'var(--color-text-mute)' }}>
          <Newspaper size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">Aún no hay noticias publicadas.</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 cv-fade-in">
          {items.map((n) => <NewsCard key={n.id} item={n} />)}
        </div>
      )}
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const fecha = new Date(item.fecha_publicacion).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  return (
    <Link to={`/news/${item.id}`} className="cv-card cv-card-hover p-4 flex flex-col gap-2"
          style={{ textDecoration: 'none' }}>
      <div className="flex items-center justify-between text-[11px]"
           style={{ color: 'var(--color-text-mute)' }}>
        <span>{fecha}</span>
        <span className="inline-flex items-center gap-1"><Eye size={12} /> {item.views}</span>
      </div>
      <h3 className="font-semibold leading-snug line-clamp-2"
          style={{ color: 'var(--color-text)' }}>{item.titulo}</h3>
      {item.resumen && (
        <p className="text-sm line-clamp-3" style={{ color: 'var(--color-text-soft)' }}>
          {item.resumen}
        </p>
      )}
      <div className="flex items-center justify-between mt-auto pt-2">
        {item.categoria
          ? <span className="cv-chip-primary inline-flex items-center gap-1 text-[11px]">
              <Tag size={11} /> {item.categoria}
            </span>
          : <span />}
        <span className="inline-flex items-center gap-1 text-xs font-medium"
              style={{ color: 'var(--color-primary)' }}>
          Leer <ArrowRight size={14} />
        </span>
      </div>
    </Link>
  );
}
