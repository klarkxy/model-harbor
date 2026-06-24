import { api } from '../client.js';
import type {
  ConsumerKeyContract,
  ConsumerKeyAccessContract,
  CreateConsumerKeyRequest,
  UpdateConsumerKeyRequest,
} from '@manageyourllm/contracts';

export type ConsumerKeyWithAccess = ConsumerKeyContract & { access: ConsumerKeyAccessContract[] };
export type CreateConsumerKeyResponse = { consumerKey: ConsumerKeyWithAccess; rawKey: string };
export type RotateConsumerKeyResponse = { consumerKey: ConsumerKeyContract; rawKey: string };

export async function listConsumerKeys(): Promise<ConsumerKeyContract[]> {
  const res = await api.get<{ data: ConsumerKeyContract[] }>('/api/admin/consumer-keys');
  return res.data;
}

export async function listConsumerKeysByApp(appId: string): Promise<ConsumerKeyContract[]> {
  const res = await api.get<{ data: ConsumerKeyContract[] }>(`/api/admin/consumer-keys?appId=${encodeURIComponent(appId)}`);
  return res.data;
}

export async function createConsumerKey(body: CreateConsumerKeyRequest): Promise<CreateConsumerKeyResponse> {
  const res = await api.post<{ data: CreateConsumerKeyResponse }>('/api/admin/consumer-keys', body);
  return res.data;
}

export async function updateConsumerKey(id: string, body: UpdateConsumerKeyRequest): Promise<ConsumerKeyWithAccess> {
  const res = await api.patch<{ data: ConsumerKeyWithAccess }>(`/api/admin/consumer-keys/${id}`, body);
  return res.data;
}

export async function rotateConsumerKey(id: string): Promise<RotateConsumerKeyResponse> {
  const res = await api.post<{ data: RotateConsumerKeyResponse }>(`/api/admin/consumer-keys/${id}/rotate`, {});
  return res.data;
}

export async function revokeConsumerKey(id: string): Promise<{ consumerKey: ConsumerKeyWithAccess }> {
  const res = await api.post<{ data: { consumerKey: ConsumerKeyWithAccess } }>(`/api/admin/consumer-keys/${id}/revoke`, {});
  return res.data;
}

export async function deleteConsumerKey(id: string): Promise<void> {
  await api.delete(`/api/admin/consumer-keys/${id}`);
}
