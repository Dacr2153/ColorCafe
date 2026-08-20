/**
 * lib/design/score.ts — Helpers visuales asociados al score de calidad.
 *
 * El color y la etiqueta son funciones puras del score real medido. Nunca
 * "ajustar" para que se vea mejor: si el café es de baja calidad, el indicador
 * debe mostrarlo con honestidad.
 */
export type ScoreBand = 'bad' | 'mid' | 'good' | 'best';

export function scoreBand(score: number | null | undefined): ScoreBand | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  if (score < 50)  return 'bad';
  if (score < 70)  return 'mid';
  if (score < 85)  return 'good';
  return 'best';
}

export function scoreColorVar(score: number | null | undefined): string {
  const b = scoreBand(score);
  switch (b) {
    case 'bad':  return 'var(--score-bad)';
    case 'mid':  return 'var(--score-mid)';
    case 'good': return 'var(--score-good)';
    case 'best': return 'var(--score-best)';
    default:     return 'var(--color-text-mute)';
  }
}

export function scoreLabel(score: number | null | undefined): string {
  const b = scoreBand(score);
  switch (b) {
    case 'bad':  return 'Baja calidad';
    case 'mid':  return 'Calidad media';
    case 'good': return 'Buena calidad';
    case 'best': return 'Excelente';
    default:     return 'Sin datos';
  }
}
