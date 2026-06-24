import { api } from '../client.js';
import type { AppContract, CreateAppRequest, UpdateAppRequest } from '@manageyourllm/contracts';

export async function listApps(): Promise<AppContract[]> {
  const res = await api.get<{ data: AppContract[] }>('/api/admin/apps');
  return res.data;
}

export async function getApp(id: string): Promise<AppContract> {
  const res = await api.get<{ data: AppContract }>(`/api/admin/apps/${id}`);
  return res.data;
}

export async function createApp(body: CreateAppRequest): Promise<AppContract> {
  const res = await api.post<{ data: AppContract }>('/api/admin/apps', body);
  return res.data;
}

export async function updateApp(id: string, body: UpdateAppRequest): Promise<AppContract> {
  const res = await api.patch<{ data: AppContract }>(`/api/admin/apps/${id}`, body);
  return res.data;
}

export async function deleteApp(id: string): Promise<void> {
  await api.delete(`/api/admin/apps/${id}`);
}
