import { api } from '../client.js';
import type {
  ModelContract,
  ModelCandidateContract,
  CreateModelRequest,
  UpdateModelRequest,
  AddCandidateRequest,
  UpdateCandidateRequest,
  SetCandidateEnabledRequest,
} from '@manageyourllm/contracts';

export type ModelWithCandidates = ModelContract & {
  candidates: ModelCandidateContract[];
};

export async function listModels(): Promise<ModelContract[]> {
  const res = await api.get<{ data: ModelContract[] }>('/api/admin/models');
  return res.data;
}

export async function getModel(id: string): Promise<ModelWithCandidates> {
  const res = await api.get<{ data: ModelWithCandidates }>(`/api/admin/models/${id}`);
  return res.data;
}

export async function createModel(body: CreateModelRequest): Promise<ModelWithCandidates> {
  const res = await api.post<{ data: ModelWithCandidates }>('/api/admin/models', body);
  return res.data;
}

export async function updateModel(
  id: string,
  body: UpdateModelRequest,
): Promise<ModelWithCandidates> {
  const res = await api.patch<{ data: ModelWithCandidates }>(`/api/admin/models/${id}`, body);
  return res.data;
}

export async function deleteModel(id: string): Promise<void> {
  await api.delete(`/api/admin/models/${id}`);
}

// --- 独立 candidate CRUD（v1 收口） ---

export async function addCandidate(
  modelId: string,
  body: AddCandidateRequest,
): Promise<ModelCandidateContract> {
  const res = await api.post<{ data: ModelCandidateContract }>(
    `/api/admin/models/${modelId}/candidates`,
    body,
  );
  return res.data;
}

export async function updateCandidate(
  candidateId: string,
  body: UpdateCandidateRequest,
): Promise<ModelCandidateContract> {
  const res = await api.patch<{ data: ModelCandidateContract }>(
    `/api/admin/models/candidates/${candidateId}`,
    body,
  );
  return res.data;
}

export async function setCandidateEnabled(
  candidateId: string,
  enabled: boolean,
): Promise<ModelCandidateContract> {
  const body: SetCandidateEnabledRequest = { enabled };
  const res = await api.post<{ data: ModelCandidateContract }>(
    `/api/admin/models/candidates/${candidateId}/enable`,
    body,
  );
  return res.data;
}

export async function deleteCandidate(candidateId: string): Promise<void> {
  await api.delete(`/api/admin/models/candidates/${candidateId}`);
}

export async function reorderCandidates(
  id: string,
  items: { candidateId: string; priority: number }[],
): Promise<ModelWithCandidates> {
  const res = await api.post<{ data: ModelWithCandidates }>(
    `/api/admin/models/${id}/candidates/reorder`,
    items,
  );
  return res.data;
}
