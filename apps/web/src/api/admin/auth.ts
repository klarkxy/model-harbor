import { api } from '../client.js';
import type { AdminSummary } from '../../stores/auth.js';

export async function login(username: string, password: string): Promise<void> {
  await api.post('/api/admin/auth/login', { username, password });
}

export async function logout(): Promise<void> {
  await api.post('/api/admin/auth/logout');
}

export async function fetchMe(): Promise<AdminSummary> {
  const res = await api.get<{ data: AdminSummary }>('/api/admin/auth/me');
  return res.data;
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await api.post('/api/admin/auth/change-password', { oldPassword, newPassword });
}
