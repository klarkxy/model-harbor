import { api } from '../client.js';
import type {
  UpstreamKeyContract,
  UpstreamKeyQuotaContract,
  CreateUpstreamKeyRequest,
  UpdateUpstreamKeyRequest,
} from '@manageyourllm/contracts';

export type UpstreamKeyWithQuota = UpstreamKeyContract & { quota?: UpstreamKeyQuotaContract | null };

export async function listUpstreamKeys(): Promise<UpstreamKeyWithQuota[]> {
  const res = await api.get<{ data: UpstreamKeyWithQuota[] }>('/api/admin/upstream-keys');
  return res.data;
}

export async function getUpstreamKey(id: string): Promise<UpstreamKeyWithQuota> {
  const res = await api.get<{ data: UpstreamKeyWithQuota }>(`/api/admin/upstream-keys/${id}`);
  return res.data;
}

export async function createUpstreamKey(body: CreateUpstreamKeyRequest): Promise<UpstreamKeyWithQuota> {
  const res = await api.post<{ data: UpstreamKeyWithQuota }>('/api/admin/upstream-keys', body);
  return res.data;
}

export async function updateUpstreamKey(id: string, body: UpdateUpstreamKeyRequest): Promise<UpstreamKeyWithQuota> {
  const res = await api.patch<{ data: UpstreamKeyWithQuota }>(`/api/admin/upstream-keys/${id}`, body);
  return res.data;
}

export async function deleteUpstreamKey(id: string): Promise<void> {
  await api.delete(`/api/admin/upstream-keys/${id}`);
}

export async function rotateUpstreamKey(id: string, apiKey: string): Promise<UpstreamKeyWithQuota> {
  const res = await api.post<{ data: UpstreamKeyWithQuota }>(`/api/admin/upstream-keys/${id}/rotate`, { apiKey });
  return res.data;
}

export async function freezeUpstreamKey(id: string, reason?: string): Promise<UpstreamKeyWithQuota> {
  const res = await api.post<{ data: UpstreamKeyWithQuota }>(`/api/admin/upstream-keys/${id}/freeze`, { reason });
  return res.data;
}

export async function unfreezeUpstreamKey(id: string): Promise<UpstreamKeyWithQuota> {
  const res = await api.post<{ data: UpstreamKeyWithQuota }>(`/api/admin/upstream-keys/${id}/unfreeze`, {});
  return res.data;
}

export async function reorderUpstreamKeys(items: { id: string; displayOrder: number }[]): Promise<void> {
  await api.post('/api/admin/upstream-keys/reorder', items);
}
