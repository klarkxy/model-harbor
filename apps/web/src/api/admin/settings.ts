import { api } from '../client.js';
import type { SettingsContract, UpdateSettingsRequest } from '@manageyourllm/contracts';

export async function getSettings(): Promise<SettingsContract> {
  const res = await api.get<{ data: SettingsContract }>('/api/admin/settings');
  return res.data;
}

export async function updateSettings(body: UpdateSettingsRequest): Promise<SettingsContract> {
  const res = await api.patch<{ data: SettingsContract }>('/api/admin/settings', body);
  return res.data;
}
