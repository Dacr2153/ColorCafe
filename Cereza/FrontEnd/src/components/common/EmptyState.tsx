/**
 * components/common/EmptyState.tsx — Vacío honesto.
 *
 * Cuando no hay datos NUNCA inventamos: mostramos un EmptyState claro y
 * accionable. Es la implementación de la directriz ética en UI.
 */
import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface Props {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: Props) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center px-6 py-12 rounded-lg border-dashed border-2"
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-soft)' }}
    >
      <div className="mb-3" style={{ color: 'var(--color-text-mute)' }}>
        {icon ?? <Inbox size={48} strokeWidth={1.5} />}
      </div>
      <h3 className="text-lg font-medium" style={{ color: 'var(--color-text)' }}>
        {title}
      </h3>
      {description ? <p className="mt-1 text-sm max-w-md">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
