import { api } from '../client.js';
import type { TraceSummaryContract, TraceDetailContract } from '@manageyourllm/contracts';

export async function getTraces(since?: string, limit = 100): Promise<TraceSummaryContract[]> {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  params.set('limit', String(limit));
  const res = await api.get<{ data: TraceSummaryContract[]; total?: number }>(
    `/api/admin/traces?${params.toString()}`,
  );
  return res.data;
}

export async function getTrace(id: string): Promise<TraceDetailContract> {
  const res = await api.get<{ data: TraceDetailContract }>(`/api/admin/traces/${encodeURIComponent(id)}`);
  return res.data;
}
