import { api } from '../client.js';
import type { ProviderPresetContract } from '@manageyourllm/contracts';

export async function listProviderPresets(): Promise<ProviderPresetContract[]> {
  const res = await api.get<{ data: ProviderPresetContract[] }>('/api/admin/provider-presets');
  return res.data;
}
