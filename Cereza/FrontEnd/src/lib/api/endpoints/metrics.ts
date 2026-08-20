/**
 * lib/api/endpoints/metrics.ts — Series temporales + agregados.
 */
import { http } from '../client';

export type Granularity = 'day' | 'week' | 'month';

export interface TimeSeriesPoint {
  bucket: string;
  count: number;
  avgScore: number | null;
  stddevScore: number | null;
  avgConfidence: number | null;
}

export const metricsApi = {
  async summary() {
    const res = await http.get<{
      total: number;
      completed: number;
      failed: number;
      processing: number;
      avgScore: number | null;
      lastCapturedAt: string | null;
    }>('/metrics/summary');
    return res.data;
  },
  async timeSeries(opts: { granularity: Granularity; from: string; to: string }) {
    const res = await http.get<{ items: TimeSeriesPoint[] }>('/metrics/timeseries', { params: opts });
    return res.data?.items ?? [];
  },
  async qualityDistribution(opts: { from: string; to: string }) {
    const res = await http.get<{ distribution: Record<string, number> }>('/metrics/quality-distribution', {
      params: opts,
    });
    return res.data.distribution;
  },
  async availability() {
    const res = await http.get<{ minCapturedAt: string | null; maxCapturedAt: string | null }>(
      '/metrics/availability',
    );
    return res.data;
  },
};
