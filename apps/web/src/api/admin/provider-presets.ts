import { api } from '../client.js';
import type {
  ProviderPresetContract,
  CreateLocalPresetRequest,
  UpdateLocalPresetRequest,
} from '@manageyourllm/contracts';

export async function listProviderPresets(): Promise<ProviderPresetContract[]> {
  const res = await api.get<{ data: ProviderPresetContract[] }>('/api/admin/provider-presets');
  return res.data;
}

export async function createProviderPreset(
  body: CreateLocalPresetRequest,
): Promise<ProviderPresetContract> {
  const res = await api.post<{ data: ProviderPresetContract }>('/api/admin/provider-presets', body);
  return res.data;
}

export async function updateProviderPreset(
  id: string,
  body: UpdateLocalPresetRequest,
): Promise<ProviderPresetContract> {
  const res = await api.put<{ data: ProviderPresetContract }>(
    `/api/admin/provider-presets/${id}`,
    body,
  );
  return res.data;
}

export async function deleteProviderPreset(id: string): Promise<void> {
  await api.delete(`/api/admin/provider-presets/${id}`);
}
