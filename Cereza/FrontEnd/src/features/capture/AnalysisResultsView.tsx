/**
 * features/capture/AnalysisResultsView.tsx — Render fiel de un AnalysisDetail.
 *
 * Sólo muestra lo que el backend devolvió. Si un campo viene `null` o vacío
 * mostramos un placeholder explícito; NUNCA rellenamos con valores plausibles.
 */
import type { AnalysisDetail } from '../../lib/api/endpoints/analysis';
import { scoreColorVar, scoreLabel } from '../../lib/design/score';

interface Props { analysis: AnalysisDetail; }

function Distribution({ title, dist }: { title: string; dist?: Record<string, number> }) {
  const entries = Object.entries(dist ?? {});
  if (entries.length === 0) {
    return (
      <section className="cv-card p-4">
        <h3 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>{title}</h3>
        <p className="text-sm" style={{ color: 'var(--color-text-mute)' }}>Sin datos.</p>
      </section>
    );
  }
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <section className="cv-card p-4">
      <h3 className="font-medium mb-3" style={{ color: 'var(--color-text)' }}>{title}</h3>
      <ul className="space-y-2">
        {entries.map(([k, v]) => {
          const pct = (v / total) * 100;
          return (
            <li key={k}>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-text-soft)' }}>{k}</span>
                <span style={{ color: 'var(--color-text)' }}>{v} · {pct.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded mt-1" style={{ background: 'var(--color-surface-2)' }}>
                <div
                  className="h-2 rounded"
                  style={{ width: `${pct}%`, background: 'var(--color-primary)' }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AnalysisResultsView({ analysis }: Props) {
  const score = analysis.overallScore;
  return (
    <div className="space-y-4">
      <section
        className="cv-card p-6 flex flex-col sm:flex-row items-center gap-6"
      >
        {analysis.imageUrl ? (
          <img
            src={analysis.imageUrl}
            alt="Muestra analizada"
            className="rounded-lg max-w-xs w-full"
            loading="lazy"
          />
        ) : null}
        <div className="flex-1">
          <div className="text-sm" style={{ color: 'var(--color-text-mute)' }}>
            {new Date(analysis.capturedAt).toLocaleString()}
          </div>
          <div className="flex items-baseline gap-3 mt-1">
            <span
              className="text-5xl font-bold"
              style={{ color: scoreColorVar(score) }}
            >
              {score !== null ? score.toFixed(1) : '—'}
            </span>
            <span className="text-sm" style={{ color: 'var(--color-text-soft)' }}>
              {scoreLabel(score)}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt style={{ color: 'var(--color-text-mute)' }}>Tipo de grano</dt>
            <dd>{analysis.grainType}</dd>
            <dt style={{ color: 'var(--color-text-mute)' }}>Granos detectados</dt>
            <dd>{analysis.totalGrainsDetected ?? analysis.grains?.length ?? 0}</dd>
            <dt style={{ color: 'var(--color-text-mute)' }}>Confianza algorítmica</dt>
            <dd>
              {analysis.confidenceScore !== null && analysis.confidenceScore !== undefined
                ? `${(analysis.confidenceScore * 100).toFixed(1)}%`
                : 'no disponible'}
            </dd>
            <dt style={{ color: 'var(--color-text-mute)' }}>Versión del algoritmo</dt>
            <dd>{analysis.algorithmVersion ?? 'desconocida'}</dd>
          </dl>
          {analysis.status === 'failed' ? (
            <p
              className="mt-3 p-3 rounded text-sm"
              style={{ background: 'var(--color-danger)', color: '#fff' }}
            >
              Análisis fallido: {analysis.errorMessage ?? 'error desconocido'}
            </p>
          ) : null}
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <Distribution title="Distribución por madurez" dist={analysis.qualityDistribution} />
        <Distribution title="Defectos detectados" dist={analysis.defectDistribution} />
      </div>

      {analysis.grains && analysis.grains.length > 0 ? (
        <section className="cv-card p-4 overflow-x-auto">
          <h3 className="font-medium mb-3" style={{ color: 'var(--color-text)' }}>
            Detalle por grano ({analysis.grains.length})
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: 'var(--color-text-mute)' }}>
                <th className="py-1">#</th>
                <th>Clase</th>
                <th>L*</th>
                <th>a*</th>
                <th>b*</th>
                <th>Defectos</th>
                <th>Confianza</th>
              </tr>
            </thead>
            <tbody>
              {analysis.grains.slice(0, 100).map((g) => (
                <tr key={g.index} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="py-1">{g.index}</td>
                  <td>{g.classification}</td>
                  <td>{g.colorLab.L.toFixed(1)}</td>
                  <td>{g.colorLab.a.toFixed(1)}</td>
                  <td>{g.colorLab.b.toFixed(1)}</td>
                  <td>{g.defects.join(', ') || '—'}</td>
                  <td>{(g.confidence * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {analysis.grains.length > 100 ? (
            <p className="text-xs mt-2" style={{ color: 'var(--color-text-mute)' }}>
              Mostrando los primeros 100 de {analysis.grains.length} granos.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
