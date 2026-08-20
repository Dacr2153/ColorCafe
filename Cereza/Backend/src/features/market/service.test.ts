/**
 * Test de la máquina de estados de órdenes.
 *
 * Reglas críticas para integridad del marketplace:
 *  - Una orden 'delivered', 'cancelled' o 'rejected' es TERMINAL.
 *  - Sólo el productor puede aceptar, rechazar, marcar en tránsito o entregado.
 *  - Sólo el comprador puede cancelar (y sólo desde pending/accepted).
 *  - No hay caminos de "rollback" silencioso: una vez cancelada, queda cancelada.
 */
import { describe, it, expect } from 'vitest';
import { canTransition, allowedActor } from './service.js';
import type { OrderStatus } from './service.js';

describe('market order state machine', () => {
  it('admite las transiciones legales', () => {
    expect(canTransition('pending', 'accepted')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
    expect(canTransition('pending', 'cancelled')).toBe(true);
    expect(canTransition('accepted', 'in_transit')).toBe(true);
    expect(canTransition('accepted', 'cancelled')).toBe(true);
    expect(canTransition('in_transit', 'delivered')).toBe(true);
  });

  it('rechaza saltos ilegales', () => {
    expect(canTransition('pending', 'in_transit')).toBe(false);
    expect(canTransition('pending', 'delivered')).toBe(false);
    expect(canTransition('rejected', 'accepted')).toBe(false);
    expect(canTransition('in_transit', 'cancelled')).toBe(false);
    expect(canTransition('in_transit', 'pending')).toBe(false);
  });

  it('estados terminales no tienen sucesores', () => {
    const terminals: OrderStatus[] = ['delivered', 'cancelled', 'rejected'];
    const anyState: OrderStatus[] = ['pending', 'accepted', 'rejected', 'in_transit', 'delivered', 'cancelled'];
    for (const t of terminals) {
      for (const next of anyState) {
        expect(canTransition(t, next), `${t} → ${next} debería ser ilegal`).toBe(false);
      }
    }
  });

  it('asigna actor por transición destino', () => {
    expect(allowedActor('cancelled')).toBe('buyer');
    expect(allowedActor('accepted')).toBe('producer');
    expect(allowedActor('rejected')).toBe('producer');
    expect(allowedActor('in_transit')).toBe('producer');
    expect(allowedActor('delivered')).toBe('producer');
  });
});
