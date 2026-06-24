import { api } from '../client.js';
import type {
  PublicModelContract,
  PublicModelCandidateContract,
  CreatePublicModelRequest,
  UpdatePublicModelRequest,
} from '@manageyourllm/contracts';

export type PublicModelWithCandidates = PublicModelContract & { candidates: PublicModelCandidateContract[] };

export async function listPublicModels(): Promise<PublicModelContract[]> {
  const res = await api.get<{ data: PublicModelContract[] }>('/api/admin/public-models');
  return res.data;
}

export async function getPublicModel(id: string): Promise<PublicModelWithCandidates> {
  const res = await api.get<{ data: PublicModelWithCandidates }>(`/api/admin/public-models/${id}`);
  return res.data;
}

export async function createPublicModel(body: CreatePublicModelRequest): Promise<PublicModelWithCandidates> {
  const res = await api.post<{ data: PublicModelWithCandidates }>('/api/admin/public-models', body);
  return res.data;
}

export async function updatePublicModel(id: string, body: UpdatePublicModelRequest): Promise<PublicModelWithCandidates> {
  const res = await api.patch<{ data: PublicModelWithCandidates }>(`/api/admin/public-models/${id}`, body);
  return res.data;
}

export async function deletePublicModel(id: string): Promise<void> {
  await api.delete(`/api/admin/public-models/${id}`);
}

export async function reorderCandidates(
  id: string,
  items: { candidateId: string; priority: number }[],
): Promise<PublicModelWithCandidates> {
  const res = await api.post<{ data: PublicModelWithCandidates }>(
    `/api/admin/public-models/${id}/candidates/reorder`,
    items,
  );
  return res.data;
}
