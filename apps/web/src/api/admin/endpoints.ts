import { api } from '../client.js';
import type {
  EndpointContract,
  CreateEndpointRequest,
  UpdateEndpointRequest,
  EndpointHealth,
  DiscoveredModel,
} from '@manageyourllm/contracts';

// Phase 2 Slice 2：endpoint API client。
// Provider Account 是账号边界；endpoint 是协议 / 健康 / 能力 / 路由边界。
// Provider Account 路由的 discover/ping 由 service 委派给 endpoint 路由。

// providerAccountId 可选：不传则返回全量 endpoint（v1 Phase 9 trace 过滤用）。
export async function listEndpoints(providerAccountId?: string): Promise<EndpointContract[]> {
  const qs = providerAccountId ? `?providerAccountId=${encodeURIComponent(providerAccountId)}` : '';
  const res = await api.get<{ data: EndpointContract[] }>(`/api/admin/endpoints${qs}`);
  return res.data;
}

export async function getEndpoint(id: string): Promise<EndpointContract> {
  const res = await api.get<{ data: EndpointContract }>(`/api/admin/endpoints/${id}`);
  return res.data;
}

export async function createEndpoint(body: CreateEndpointRequest): Promise<EndpointContract> {
  const res = await api.post<{ data: EndpointContract }>('/api/admin/endpoints', body);
  return res.data;
}

export async function updateEndpoint(
  id: string,
  body: UpdateEndpointRequest,
): Promise<EndpointContract> {
  const res = await api.patch<{ data: EndpointContract }>(`/api/admin/endpoints/${id}`, body);
  return res.data;
}

export async function setEndpointEnabled(id: string, enabled: boolean): Promise<EndpointContract> {
  const res = await api.post<{ data: EndpointContract }>(
    `/api/admin/endpoints/${enabled ? 'enable' : 'disable'}`,
    { enabled },
  );
  return res.data;
}

export async function deleteEndpoint(id: string): Promise<void> {
  await api.delete(`/api/admin/endpoints/${id}`);
}

export async function resetEndpointDefaults(
  providerAccountId: string,
): Promise<EndpointContract[]> {
  const res = await api.post<{ data: EndpointContract[] }>('/api/admin/endpoints/reset-defaults', {
    providerAccountId,
  });
  return res.data;
}

export async function reorderEndpoints(
  items: { id: string; displayOrder: number }[],
): Promise<void> {
  await api.post('/api/admin/endpoints/reorder', { items });
}

export async function discoverEndpointModels(id: string): Promise<DiscoveredModel[]> {
  const res = await api.post<{ data: DiscoveredModel[] }>(`/api/admin/endpoints/${id}/discover`);
  return res.data;
}

export async function pingEndpoint(
  id: string,
  model?: string,
): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  const res = await api.post<{ data: { ok: boolean; latencyMs: number; error: string | null } }>(
    `/api/admin/endpoints/${id}/ping`,
    { model },
  );
  return res.data;
}

export async function getEndpointHealth(id: string): Promise<EndpointHealth | null> {
  const res = await api.get<{ data: EndpointHealth | null }>(`/api/admin/endpoints/${id}/health`);
  return res.data;
}
