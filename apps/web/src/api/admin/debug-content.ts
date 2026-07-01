import { api } from '../client.js';

// v1 Phase 7：debug content logs 作为 Trace 的临时 tab。
// API 不再独立页面（与 Traces 合并），但保留独立 client 以复用。
export async function listDebugContentLogs<T>(limit = 50): Promise<T[]> {
  const res = await api.get<{ data: T[] }>(`/api/admin/debug-content?limit=${limit}`);
  return res.data;
}

export async function getDebugContentLogByTraceId<T>(traceId: string): Promise<T> {
  const res = await api.get<{ data: T }>(`/api/admin/debug-content/${traceId}`);
  return res.data;
}
