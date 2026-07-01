import { api } from '../client.js';

// Phase 1 Slice 2 + Phase 6 收口：Client API client。
//
// v1 概念：一个 Client 一个 active key。
// - `/api/admin/clients`             Client CRUD
// - `/api/admin/clients/:id/key`     active key 操作（rotate / revoke / list）
//
// 旧 `/api/admin/clients/keys/*` 已在 Phase 6 收口后移除。

export async function listClients<T>(): Promise<T[]> {
  const res = await api.get<{ data: T[] }>('/api/admin/clients');
  return res.data;
}

export async function getClient<T>(id: string): Promise<T> {
  const res = await api.get<{ data: T }>(`/api/admin/clients/${id}`);
  return res.data;
}

export async function createClient<T>(body: unknown): Promise<T> {
  const res = await api.post<{ data: T }>('/api/admin/clients', body);
  return res.data;
}

export async function updateClient<T>(id: string, body: unknown): Promise<T> {
  const res = await api.patch<{ data: T }>(`/api/admin/clients/${id}`, body);
  return res.data;
}

export async function deleteClient(id: string): Promise<void> {
  await api.delete(`/api/admin/clients/${id}`);
}

// Client active key 操作（以 clientId 为主键）。
export async function listClientKeys<T>(clientId: string): Promise<T[]> {
  const res = await api.get<{ data: T[] }>(`/api/admin/clients/${clientId}/key`);
  return res.data;
}

export async function rotateClientActiveKey<T>(clientId: string): Promise<T> {
  const res = await api.post<{ data: T }>(`/api/admin/clients/${clientId}/key/rotate`, {});
  return res.data;
}

export async function revokeClientActiveKey<T>(clientId: string): Promise<T> {
  const res = await api.post<{ data: T }>(`/api/admin/clients/${clientId}/key/revoke`, {});
  return res.data;
}

// Client key rotate / revoke 响应形状。
export type ClientKeyRotatedResponse<T> = { clientKey: T; rawKey: string };
export type ClientKeyRevokedResponse<T> = { clientKey: T };
