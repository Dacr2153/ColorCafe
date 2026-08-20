/**
 * features/marketplace/MyOrdersPage.tsx — Mis órdenes (comprador o productor).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { marketApi, type OrderStatus } from '../../lib/api/endpoints/market';
import { EmptyState } from '../../components/common/EmptyState';
import { ShoppingBag, Inbox } from 'lucide-react';

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  in_transit: 'En tránsito',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'var(--color-warning)',
  accepted: 'var(--color-info)',
  rejected: 'var(--color-danger)',
  in_transit: 'var(--color-primary)',
  delivered: 'var(--color-success)',
  cancelled: 'var(--color-text-mute)',
};

export function MyOrdersPage() {
  const [role, setRole] = useState<'buyer' | 'producer'>('buyer');
  const q = useQuery({
    queryKey: ['orders', 'mine', role],
    queryFn: () => marketApi.listOrders(role),
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
            {role === 'buyer' ? <ShoppingBag size={20} /> : <Inbox size={20} />}
          </span>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Mis órdenes</h1>
            <p className="text-sm" style={{ color: 'var(--color-text-mute)' }}>
              Seguimiento de transacciones {role === 'buyer' ? 'que has hecho' : 'que has recibido'}.
            </p>
          </div>
        </div>
        <div className="inline-flex rounded-full p-1 border"
             style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}>
          {(['buyer', 'producer'] as const).map((r) => (
            <button key={r} onClick={() => setRole(r)}
                    className="px-4 py-1.5 text-sm rounded-full font-medium transition-all"
                    style={{
                      background: role === r ? 'var(--color-primary)' : 'transparent',
                      color: role === r ? '#fff' : 'var(--color-text-soft)',
                      boxShadow: role === r ? 'var(--shadow-1)' : 'none',
                    }}>
              {r === 'buyer' ? 'Como comprador' : 'Como productor'}
            </button>
          ))}
        </div>
      </header>

      {q.isLoading ? (
        <div className="space-y-2">
          {[1,2,3].map((i) => <div key={i} className="cv-skeleton h-20" />)}
        </div>
      ) : (q.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={role === 'buyer' ? <ShoppingBag size={40} strokeWidth={1.5} /> : <Inbox size={40} strokeWidth={1.5} />}
          title={role === 'buyer' ? 'Aún no has comprado ningún lote' : 'Aún no has recibido órdenes'}
          description={role === 'buyer'
            ? 'Explora el marketplace y haz tu primera orden.'
            : 'Cuando un comprador haga una orden sobre uno de tus lotes aparecerá aquí.'}
          action={role === 'buyer' ? (
            <Link to="/marketplace" className="cv-btn cv-btn-primary">
              Ir al marketplace
            </Link>
          ) : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {q.data!.map((o) => (
            <li key={o.id}>
              <Link to={`/marketplace/orders/${o.id}`}
                    className="cv-card cv-card-hover p-4 flex items-center justify-between gap-3 block"
                    style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{o.listing_titulo}</p>
                  <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-soft)' }}>
                    {o.cantidad_kg} kg · <strong>${o.precio_total.toLocaleString()} COP</strong>
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-mute)' }}>
                    {new Date(o.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <span className="text-xs font-medium px-3 py-1 rounded-full text-white shrink-0"
                      style={{ background: STATUS_COLORS[o.status] }}>
                  {STATUS_LABEL[o.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
