/**
 * features/marketplace/OrderDetailPage.tsx — Chat por orden + transiciones.
 *
 * - Suscribe a `order:{id}` por WebSocket para mensajes y cambios de estado.
 * - Las transiciones disponibles dependen del rol y del estado actual (la
 *   máquina de estados real está en backend; aquí sólo presentamos opciones).
 */
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { marketApi, type OrderStatus } from '../../lib/api/endpoints/market';
import { useAuthStore } from '../../lib/auth/store';
import { useLiveTopic } from '../../lib/ws/useAnalysisLive';
import { ArrowLeft, Send, AlertCircle, MessageSquare } from 'lucide-react';

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending:    'var(--color-warning)',
  accepted:   'var(--color-info)',
  rejected:   'var(--color-danger)',
  in_transit: 'var(--color-primary)',
  delivered:  'var(--color-success)',
  cancelled:  'var(--color-text-mute)',
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  in_transit: 'En tránsito',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
};

function nextStatuses(role: 'buyer' | 'producer', status: OrderStatus): OrderStatus[] {
  if (role === 'producer') {
    if (status === 'pending') return ['accepted', 'rejected'];
    if (status === 'accepted') return ['in_transit'];
    if (status === 'in_transit') return ['delivered'];
  } else {
    if (status === 'pending' || status === 'accepted') return ['cancelled'];
  }
  return [];
}

export function OrderDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');

  const orderQ = useQuery({
    queryKey: ['order', id],
    queryFn: () => marketApi.getOrder(id),
    enabled: !!id,
  });
  const msgsQ = useQuery({
    queryKey: ['order', id, 'messages'],
    queryFn: () => marketApi.listMessages(id, { limit: 100 }),
    enabled: !!id,
  });

  useLiveTopic(id ? `order:${id}` : null, (evt) => {
    if (evt.type === 'order.message' && evt.payload.orderId === id) {
      qc.invalidateQueries({ queryKey: ['order', id, 'messages'] });
    } else if (evt.type === 'order.status_changed' && evt.payload.orderId === id) {
      qc.invalidateQueries({ queryKey: ['order', id] });
    }
  });

  useEffect(() => { /* scroll bottom on new msg */
    const el = document.getElementById('cv-msg-bottom');
    el?.scrollIntoView({ behavior: 'smooth' });
  }, [msgsQ.data?.length]);

  async function send() {
    const text = draft.trim();
    if (!text || !id) return;
    setDraft('');
    try {
      await marketApi.postMessage(id, text);
      qc.invalidateQueries({ queryKey: ['order', id, 'messages'] });
    } catch {
      // re-poner el texto si falla
      setDraft(text);
    }
  }

  async function transition(s: OrderStatus) {
    if (!id || s === 'pending') return;
    await marketApi.transitionOrder(id, s);
    qc.invalidateQueries({ queryKey: ['order', id] });
  }

  if (orderQ.isLoading) return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="cv-skeleton h-4 w-32" />
      <div className="cv-skeleton h-24" />
      <div className="cv-skeleton h-[500px]" />
    </div>
  );
  if (orderQ.isError || !orderQ.data) return (
    <div className="p-6 max-w-2xl mx-auto cv-card text-center space-y-3">
      <span className="w-12 h-12 mx-auto rounded-full flex items-center justify-center"
            style={{ background: '#FCD7D5', color: 'var(--color-danger)' }}>
        <AlertCircle size={22} />
      </span>
      <p>No tienes acceso a esta orden.</p>
    </div>
  );

  const order = orderQ.data;
  const role: 'buyer' | 'producer' = order.buyer_id === user?.id ? 'buyer' : 'producer';
  const transitions = nextStatuses(role, order.status);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      <Link to="/marketplace/orders" className="cv-btn cv-btn-ghost cv-btn-sm w-fit">
        <ArrowLeft size={14} /> Mis órdenes
      </Link>

      <section className="cv-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{order.listing_titulo}</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-soft)' }}>
              {order.cantidad_kg} kg · <strong className="tabular-nums">${order.precio_total.toLocaleString()} COP</strong>
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-mute)' }}>
              Eres el <strong>{role === 'buyer' ? 'comprador' : 'productor'}</strong>
            </p>
          </div>
          <span className="text-xs font-semibold px-3 py-1.5 rounded-full text-white shrink-0"
                style={{ background: STATUS_COLORS[order.status] }}>
            {STATUS_LABELS[order.status]}
          </span>
        </div>
        {transitions.length > 0 && (
          <div className="mt-4 pt-4 border-t flex gap-2 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
            {transitions.map((s) => {
              const danger = s === 'rejected' || s === 'cancelled';
              return (
                <button key={s} onClick={() => transition(s)}
                        className={`cv-btn cv-btn-sm ${danger ? 'cv-btn-danger' : 'cv-btn-primary'}`}>
                  Marcar como {STATUS_LABELS[s].toLowerCase()}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="cv-card flex flex-col overflow-hidden" style={{ height: 'min(560px, 70vh)' }}>
        <h2 className="px-4 py-3 border-b font-semibold flex items-center gap-2"
            style={{ borderColor: 'var(--color-border)' }}>
          <MessageSquare size={16} style={{ color: 'var(--color-primary)' }} /> Mensajes
        </h2>
        <div className="flex-1 overflow-y-auto p-4 space-y-2"
             style={{ background: 'var(--color-surface-2)' }}>
          {msgsQ.isLoading ? (
            <div className="space-y-2">
              <div className="cv-skeleton h-12 w-2/3" />
              <div className="cv-skeleton h-12 w-1/2 ml-auto" />
            </div>
          ) : (msgsQ.data?.length ?? 0) === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-2">
              <MessageSquare size={32} strokeWidth={1.5} style={{ color: 'var(--color-text-mute)' }} />
              <p className="text-sm" style={{ color: 'var(--color-text-mute)' }}>
                Aún no hay mensajes. Coordina los detalles aquí.
              </p>
            </div>
          ) : (
            msgsQ.data!.map((m) => {
              const mine = m.sender_id === user?.id;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[80%] px-3.5 py-2 rounded-2xl text-sm shadow-sm"
                       style={{
                         background: mine ? 'var(--color-primary)' : 'var(--color-surface)',
                         color: mine ? '#fff' : 'var(--color-text)',
                         borderBottomRightRadius: mine ? 4 : 16,
                         borderBottomLeftRadius:  mine ? 16 : 4,
                         border: mine ? 'none' : '1px solid var(--color-border)',
                       }}>
                    <p className="whitespace-pre-wrap break-words">{m.mensaje}</p>
                    <p className="text-[10px] mt-1 opacity-70 tabular-nums">
                      {new Date(m.created_at).toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div id="cv-msg-bottom" />
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); void send(); }}
          className="flex gap-2 p-3 border-t"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <input
            value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="Escribe un mensaje…"
            className="cv-input flex-1"
          />
          <button type="submit" disabled={!draft.trim()}
                  className="cv-btn cv-btn-primary">
            <Send size={14} /> <span className="hidden sm:inline">Enviar</span>
          </button>
        </form>
      </section>
    </div>
  );
}
