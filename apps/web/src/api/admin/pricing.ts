import { api } from '../client.js';
import type {
  PricingEntryContract,
  CreatePricingEntryRequest,
  UpdatePricingEntryRequest,
} from '@manageyourllm/contracts';

export async function listPricingEntries(): Promise<PricingEntryContract[]> {
  const res = await api.get<{ data: PricingEntryContract[] }>('/api/admin/pricing');
  return res.data;
}

export async function createPricingEntry(body: CreatePricingEntryRequest): Promise<PricingEntryContract> {
  const res = await api.post<{ data: PricingEntryContract }>('/api/admin/pricing', body);
  return res.data;
}

export async function updatePricingEntry(
  id: string,
  body: UpdatePricingEntryRequest,
): Promise<PricingEntryContract> {
  const res = await api.put<{ data: PricingEntryContract }>(`/api/admin/pricing/${id}`, body);
  return res.data;
}

export async function deletePricingEntry(id: string): Promise<void> {
  await api.delete(`/api/admin/pricing/${id}`);
}
