/**
 * components/common/Disclaimer.tsx — Aviso de honestidad obligatorio en pantallas de análisis.
 *
 * Directriz ética: el análisis automático es ORIENTATIVO. Las decisiones
 * comerciales requieren catación física certificada. Este aviso debe estar
 * SIEMPRE visible en resultados.
 */
import { Info } from 'lucide-react';

interface Props {
  variant?: 'inline' | 'banner';
  /** Texto adicional opcional al final del aviso base. */
  extra?: string;
}

export function Disclaimer({ variant = 'inline', extra }: Props) {
  const base =
    'Este análisis es orientativo. Está basado en visión por computador y NO sustituye a una catación física certificada. Para decisiones comerciales contacte a un catador profesional.';
  const cls =
    variant === 'banner'
      ? 'flex gap-3 p-4 rounded-lg border'
      : 'flex gap-2 p-3 rounded-md text-sm border';
  return (
    <div
      className={cls}
      style={{
        background: 'var(--color-primary-soft)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text)',
      }}
      role="note"
    >
      <Info size={variant === 'banner' ? 20 : 16} className="shrink-0 mt-0.5" />
      <p>
        <strong>Aviso:</strong> {base}
        {extra ? ` ${extra}` : ''}
      </p>
    </div>
  );
}
