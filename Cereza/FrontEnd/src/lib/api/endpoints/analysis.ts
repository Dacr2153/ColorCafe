/**
 * lib/api/endpoints/analysis.ts — Endpoints de análisis de granos.
 */
import { http } from '../client';

export interface AnalysisSummary {
  id: string;
  capturedAt: string;
  farmId: string | null;
  grainType: 'cereza' | 'pergamino' | 'trilla';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  overallScore: number | null;
  thumbnailKey: string | null;
}

export interface AnalysisDetail extends AnalysisSummary {
  imageUrl?: string;
  thumbnailUrl?: string;
  qualityDistribution?: Record<string, number>;
  defectDistribution?: Record<string, number>;
  confidenceScore?: number | null;
  algorithmVersion?: string | null;
  colorProfile?: Record<string, number> | null;
  errorMessage?: string | null;
  totalGrainsDetected?: number;
  grains?: Array<{
    index: number;
    bbox: { x: number; y: number; w: number; h: number };
    classification: string;
    defects: string[];
    confidence: number;
    colorLab: { L: number; a: number; b: number };
  }>;
}

export interface SubmitAnalysisInput {
  farmId: string;
  grainType: 'cereza' | 'pergamino' | 'trilla';
  sampleWeightG: number;
  captureConditions?: Record<string, unknown>;
  file: File | Blob;
}

export const analysisApi = {
  async submit(input: SubmitAnalysisInput, opts?: { onProgress?: (pct: number) => void }) {
    const fd = new FormData();
    fd.append('farmId', input.farmId);
    fd.append('grainType', input.grainType);
    fd.append('sampleWeightG', String(input.sampleWeightG));
    if (input.captureConditions) {
      fd.append('captureConditions', JSON.stringify(input.captureConditions));
    }
    fd.append('image', input.file);
    const res = await http.post<{ analysis: AnalysisSummary }>('/analysis', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (opts?.onProgress && e.total) {
          opts.onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    });
    return res.data.analysis;
  },
  async list(params?: { limit?: number; before?: string; farmId?: string }) {
    const res = await http.get<{ items: AnalysisSummary[]; nextBefore?: string | null }>(
      '/analysis',
      { params },
    );
    return res.data;
  },
  async get(id: string, capturedAt?: string): Promise<AnalysisDetail> {
    const res = await http.get<{
      analysis: Record<string, unknown>;
      grains?: Array<Record<string, unknown>>;
      imageUrl?: string | null;
      thumbnailUrl?: string | null;
    }>(`/analysis/${id}`, {
      params: capturedAt ? { capturedAt } : undefined,
    });
    const a = res.data.analysis ?? {};
    const grains = (res.data.grains ?? []).map((g) => ({
      index: Number(g.grain_index ?? g.index ?? 0),
      bbox: {
        x: Number(g.bbox_x ?? (g.bbox as { x?: number } | undefined)?.x ?? 0),
        y: Number(g.bbox_y ?? (g.bbox as { y?: number } | undefined)?.y ?? 0),
        w: Number(g.bbox_w ?? (g.bbox as { w?: number } | undefined)?.w ?? 0),
        h: Number(g.bbox_h ?? (g.bbox as { h?: number } | undefined)?.h ?? 0),
      },
      classification: String(g.classification ?? 'desconocido'),
      defects: Array.isArray(g.defects) ? (g.defects as string[]) : [],
      confidence: Number(g.confidence ?? 0),
      colorLab: (g.color_lab as { L: number; a: number; b: number } | undefined)
        ?? (g.colorLab as { L: number; a: number; b: number } | undefined)
        ?? { L: 0, a: 0, b: 0 },
    }));
    const total = Number(a.totalGrainsDetected ?? a.total_grains_detected ?? grains.length);
    return {
      id: String(a.id ?? id),
      capturedAt: String(a.capturedAt ?? a.captured_at ?? new Date().toISOString()),
      farmId: (a.farmId ?? a.farm_id ?? null) as string | null,
      grainType: (a.grainType ?? a.grain_type ?? 'cereza') as 'cereza' | 'pergamino' | 'trilla',
      status: (a.status ?? a.processingStatus ?? a.processing_status ?? 'completed') as AnalysisSummary['status'],
      overallScore: a.overallScore === null || a.overallScore === undefined
        ? null
        : Number(a.overallScore),
      thumbnailKey: (a.thumbnailKey ?? a.thumbnailStorageRef ?? a.thumbnail_storage_ref ?? null) as string | null,
      imageUrl: res.data.imageUrl ?? undefined,
      thumbnailUrl: res.data.thumbnailUrl ?? undefined,
      qualityDistribution: (a.qualityDistribution ?? a.quality_distribution ?? undefined) as Record<string, number> | undefined,
      defectDistribution: (a.defectDistribution ?? a.defect_distribution ?? undefined) as Record<string, number> | undefined,
      confidenceScore: a.confidenceScore === null || a.confidenceScore === undefined
        ? null
        : Number(a.confidenceScore),
      algorithmVersion: (a.algorithmVersion ?? a.algorithm_version ?? null) as string | null,
      colorProfile: (a.colorProfile ?? a.color_profile ?? null) as Record<string, number> | null,
      errorMessage: (a.errorMessage ?? a.error_message ?? null) as string | null,
      grains,
      totalGrainsDetected: total,
    };
  },
  async retry(id: string) {
    const res = await http.post<{ analysis: AnalysisSummary }>(`/analysis/${id}/retry`);
    return res.data.analysis;
  },
  async remove(id: string) {
    await http.delete(`/analysis/${id}`);
  },
};
