import { api } from '../client.js';
import type {
  ModelGroupContract,
  ModelGroupMemberContract,
  CreateModelGroupRequest,
  UpdateModelGroupRequest,
  ReplaceMembersRequest,
} from '@manageyourllm/contracts';

export type ModelGroupWithMembers = ModelGroupContract & { members: ModelGroupMemberContract[] };

export async function listModelGroups(): Promise<ModelGroupContract[]> {
  const res = await api.get<{ data: ModelGroupContract[] }>('/api/admin/model-groups');
  return res.data;
}

export async function getModelGroup(id: string): Promise<ModelGroupWithMembers> {
  const res = await api.get<{ data: ModelGroupWithMembers }>(`/api/admin/model-groups/${id}`);
  return res.data;
}

export async function createModelGroup(body: CreateModelGroupRequest): Promise<ModelGroupWithMembers> {
  const res = await api.post<{ data: ModelGroupWithMembers }>('/api/admin/model-groups', body);
  return res.data;
}

export async function updateModelGroup(id: string, body: UpdateModelGroupRequest): Promise<ModelGroupWithMembers> {
  const res = await api.patch<{ data: ModelGroupWithMembers }>(`/api/admin/model-groups/${id}`, body);
  return res.data;
}

export async function deleteModelGroup(id: string): Promise<void> {
  await api.delete(`/api/admin/model-groups/${id}`);
}

export async function replaceMembers(id: string, body: ReplaceMembersRequest): Promise<ModelGroupWithMembers> {
  const res = await api.post<{ data: ModelGroupWithMembers }>(`/api/admin/model-groups/${id}/members/replace`, body);
  return res.data;
}
