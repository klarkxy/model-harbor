import { api } from '../client.js';
import type { DebugContentLogContract } from '@manageyourllm/contracts';

export async function listDebugContentLogs(limit = 50): Promise<DebugContentLogContract[]> {
  const res = await api.get<{ data: DebugContentLogContract[]; total?: number }>(
    `/api/admin/debug-content?limit=${limit}`,
  );
  return res.data;
}

export async function getDebugContentLogByTraceId(
  traceId: string,
): Promise<DebugContentLogContract> {
  const res = await api.get<{ data: DebugContentLogContract }>(
    `/api/admin/debug-content/${encodeURIComponent(traceId)}`,
  );
  return res.data;
}
