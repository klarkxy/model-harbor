import { api } from '../client.js';
import type {
  ProviderAccountContract,
  ProviderAccountQuotaContract,
  CreateProviderAccountRequest,
  UpdateProviderAccountRequest,
  DiscoveredModel,
} from '@manageyourllm/contracts';

// Phase 2 Slice 1：Provider Account API client。
// 类型与函数名统一为 v1 新概念（Provider Account），URL 保持 `/api/admin/provider-accounts`。
// 旧的 `upstream-keys.ts` 标 deprecated；前端页面在 Phase 7 收口前继续可工作。

export type ProviderAccount = ProviderAccountContract & {
  quota?: ProviderAccountQuotaContract | null;
};

export async function listProviderAccounts(): Promise<ProviderAccount[]> {
  const res = await api.get<{ data: ProviderAccount[] }>('/api/admin/provider-accounts');
  return res.data;
}

export async function getProviderAccount(id: string): Promise<ProviderAccount> {
  const res = await api.get<{ data: ProviderAccount }>(`/api/admin/provider-accounts/${id}`);
  return res.data;
}

export async function createProviderAccount(
  body: CreateProviderAccountRequest,
): Promise<ProviderAccount> {
  const res = await api.post<{ data: ProviderAccount }>('/api/admin/provider-accounts', body);
  return res.data;
}

export async function updateProviderAccount(
  id: string,
  body: UpdateProviderAccountRequest,
): Promise<ProviderAccount> {
  const res = await api.patch<{ data: ProviderAccount }>(
    `/api/admin/provider-accounts/${id}`,
    body,
  );
  return res.data;
}

export async function deleteProviderAccount(id: string): Promise<void> {
  await api.delete(`/api/admin/provider-accounts/${id}`);
}

export async function rotateProviderAccount(id: string, apiKey: string): Promise<ProviderAccount> {
  const res = await api.post<{ data: ProviderAccount }>(
    `/api/admin/provider-accounts/${id}/rotate`,
    { apiKey },
  );
  return res.data;
}

export async function freezeProviderAccount(id: string, reason?: string): Promise<ProviderAccount> {
  const res = await api.post<{ data: ProviderAccount }>(
    `/api/admin/provider-accounts/${id}/freeze`,
    { reason },
  );
  return res.data;
}

export async function unfreezeProviderAccount(id: string): Promise<ProviderAccount> {
  const res = await api.post<{ data: ProviderAccount }>(
    `/api/admin/provider-accounts/${id}/unfreeze`,
    {},
  );
  return res.data;
}

export async function reorderProviderAccounts(
  items: { id: string; displayOrder: number }[],
): Promise<void> {
  await api.post('/api/admin/provider-accounts/reorder', items);
}

export async function discoverProviderAccountModels(id: string): Promise<DiscoveredModel[]> {
  const res = await api.post<{ data: DiscoveredModel[] }>(
    `/api/admin/provider-accounts/${id}/discover`,
  );
  return res.data;
}

export async function pingProviderAccount(
  id: string,
  model?: string,
): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  const res = await api.post<{ data: { ok: boolean; latencyMs: number; error: string | null } }>(
    `/api/admin/provider-accounts/${id}/ping`,
    { model },
  );
  return res.data;
}
