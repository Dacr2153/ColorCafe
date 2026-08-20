/**
 * features/news/NewsComments.tsx — Foro de discusión por noticia.
 *
 * - Lista plana con respuestas anidadas (1 nivel).
 * - Crear comentario / responder (requiere auth).
 * - Eliminar (autor o admin) → soft delete.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Send, Reply, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { contentApi, type NewsComment } from '../../lib/api/endpoints/content';
import { ApiError } from '../../lib/api/client';
import { useAuthStore, selectIsAuthenticated } from '../../lib/auth/store';

interface CommentNode extends NewsComment {
  replies: NewsComment[];
}

export function NewsComments({ newsId }: { newsId: string }) {
  const qc = useQueryClient();
  const isAuth = useAuthStore(selectIsAuthenticated);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const currentUserRole = useAuthStore((s) => s.user?.role);

  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<NewsComment | null>(null);

  const { data: comments = [], isLoading, error } = useQuery({
    queryKey: ['news-comments', newsId],
    queryFn: () => contentApi.listComments(newsId),
  });

  const create = useMutation({
    mutationFn: (payload: { body: string; parentId?: string | null }) =>
      contentApi.createComment(newsId, payload.body, payload.parentId ?? null),
    onSuccess: () => {
      setBody('');
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: ['news-comments', newsId] });
    },
  });

  const remove = useMutation({
    mutationFn: (commentId: string) => contentApi.deleteComment(commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['news-comments', newsId] }),
  });

  const tree: CommentNode[] = useMemo(() => {
    const byParent = new Map<string, NewsComment[]>();
    const roots: NewsComment[] = [];
    for (const c of comments) {
      if (c.parent_id) {
        const arr = byParent.get(c.parent_id) ?? [];
        arr.push(c);
        byParent.set(c.parent_id, arr);
      } else {
        roots.push(c);
      }
    }
    return roots
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .map((r) => ({ ...r, replies: (byParent.get(r.id) ?? []).sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)) }));
  }, [comments]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    create.mutate({ body: body.trim(), parentId: replyTo?.id ?? null });
  };

  return (
    <section className="mt-6 space-y-4">
      <header className="flex items-center gap-2">
        <MessageCircle size={20} style={{ color: 'var(--color-primary)' }} />
        <h2 className="text-lg font-bold">Discusión ({comments.length})</h2>
      </header>

      {isAuth ? (
        <form onSubmit={onSubmit} className="cv-card p-3 space-y-2">
          {replyTo && (
            <div className="text-xs flex items-center justify-between"
                 style={{ color: 'var(--color-text-mute)' }}>
              <span>Respondiendo a <b>{replyTo.user_nombre ?? 'usuario'}</b></span>
              <button type="button" onClick={() => setReplyTo(null)}
                      className="font-medium" style={{ color: 'var(--color-primary)' }}>
                Cancelar
              </button>
            </div>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="cv-input"
            rows={3}
            maxLength={4000}
            placeholder={replyTo ? 'Escribe tu respuesta…' : '¿Qué opinas? Comparte una experiencia o pregunta…'}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px]" style={{ color: 'var(--color-text-mute)' }}>
              {body.length}/4000
            </span>
            <button
              type="submit"
              disabled={create.isPending || !body.trim()}
              className="cv-btn cv-btn-primary cv-btn-sm"
            >
              {create.isPending
                ? <><Loader2 size={14} className="animate-spin" /> Publicando…</>
                : <><Send size={14} /> Publicar</>}
            </button>
          </div>
          {create.error instanceof ApiError && (
            <p className="text-xs" style={{ color: 'var(--color-danger)' }}>
              {create.error.message || 'No se pudo publicar el comentario.'}
            </p>
          )}
        </form>
      ) : (
        <div className="cv-card p-3 text-sm flex items-center justify-between flex-wrap gap-2"
             style={{ color: 'var(--color-text-soft)' }}>
          <span>Inicia sesión para participar en la discusión.</span>
          <Link to="/login" className="cv-btn cv-btn-primary cv-btn-sm">Entrar</Link>
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map((i) => <div key={i} className="cv-skeleton h-20 w-full rounded-2xl" />)}
        </div>
      )}

      {error instanceof ApiError && (
        <div className="cv-card p-3 flex items-start gap-2"
             style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span className="text-sm">{error.message || 'No se pudo cargar la discusión.'}</span>
        </div>
      )}

      {!isLoading && !error && tree.length === 0 && (
        <p className="text-sm text-center py-6"
           style={{ color: 'var(--color-text-mute)' }}>
          Sé el primero en comentar.
        </p>
      )}

      <ul className="space-y-3">
        {tree.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            replies={c.replies}
            currentUserId={currentUserId ?? null}
            isAdmin={currentUserRole === 'admin'}
            isAuth={isAuth}
            onReply={(t) => { setReplyTo(t); }}
            onDelete={(id) => { if (confirm('¿Eliminar este comentario?')) remove.mutate(id); }}
            removing={remove.isPending}
          />
        ))}
      </ul>
    </section>
  );
}

function CommentItem({
  comment, replies, currentUserId, isAdmin, isAuth, onReply, onDelete, removing,
}: {
  comment: NewsComment;
  replies: NewsComment[];
  currentUserId: string | null;
  isAdmin: boolean;
  isAuth: boolean;
  onReply: (c: NewsComment) => void;
  onDelete: (id: string) => void;
  removing: boolean;
}) {
  return (
    <li className="cv-card p-3 space-y-2">
      <CommentBody c={comment} canDelete={isAuth && (isAdmin || comment.user_id === currentUserId)}
                   onReply={isAuth ? () => onReply(comment) : undefined}
                   onDelete={() => onDelete(comment.id)}
                   removing={removing} />
      {replies.length > 0 && (
        <ul className="space-y-2 pl-4 border-l-2"
            style={{ borderColor: 'var(--color-border)' }}>
          {replies.map((r) => (
            <li key={r.id} className="pt-2">
              <CommentBody c={r}
                           canDelete={isAuth && (isAdmin || r.user_id === currentUserId)}
                           onDelete={() => onDelete(r.id)}
                           removing={removing} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function CommentBody({
  c, canDelete, onReply, onDelete, removing,
}: {
  c: NewsComment;
  canDelete: boolean;
  onReply?: () => void;
  onDelete: () => void;
  removing: boolean;
}) {
  const initial = (c.user_nombre || '?').trim()[0]?.toUpperCase() ?? '?';
  const when = new Date(c.created_at).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  return (
    <div className="flex gap-3">
      <span className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold"
            style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
        {initial}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{c.user_nombre ?? 'Usuario'}</span>
          {c.user_role && c.user_role !== 'buyer' && c.user_role !== 'producer' && (
            <span className="cv-chip-primary text-[10px]">{c.user_role}</span>
          )}
          <span className="text-[11px]" style={{ color: 'var(--color-text-mute)' }}>{when}</span>
          {c.edited_at && !c.is_deleted && (
            <span className="text-[11px] italic" style={{ color: 'var(--color-text-mute)' }}>(editado)</span>
          )}
        </div>
        <p className={`text-sm mt-1 whitespace-pre-wrap ${c.is_deleted ? 'italic' : ''}`}
           style={{ color: c.is_deleted ? 'var(--color-text-mute)' : 'var(--color-text)' }}>
          {c.body}
        </p>
        {!c.is_deleted && (
          <div className="flex items-center gap-3 mt-2">
            {onReply && (
              <button type="button" onClick={onReply}
                      className="inline-flex items-center gap-1 text-xs font-medium"
                      style={{ color: 'var(--color-text-soft)' }}>
                <Reply size={12} /> Responder
              </button>
            )}
            {canDelete && (
              <button type="button" onClick={onDelete} disabled={removing}
                      className="inline-flex items-center gap-1 text-xs font-medium"
                      style={{ color: 'var(--color-danger)' }}>
                <Trash2 size={12} /> Eliminar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
