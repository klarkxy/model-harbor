import { api } from '../client.js';
import type {
  ChannelContract,
  ChannelMemberContract,
  CreateChannelRequest,
  UpdateChannelRequest,
  ReplaceChannelMembersRequest,
} from '@manageyourllm/contracts';

export type ChannelWithMembers = ChannelContract & { members: ChannelMemberContract[] };

export async function listChannels(): Promise<ChannelContract[]> {
  const res = await api.get<{ data: ChannelContract[] }>('/api/admin/channels');
  return res.data;
}

export async function getChannel(id: string): Promise<ChannelWithMembers> {
  const res = await api.get<{ data: ChannelWithMembers }>(`/api/admin/channels/${id}`);
  return res.data;
}

export async function createChannel(body: CreateChannelRequest): Promise<ChannelWithMembers> {
  const res = await api.post<{ data: ChannelWithMembers }>('/api/admin/channels', body);
  return res.data;
}

export async function updateChannel(
  id: string,
  body: UpdateChannelRequest,
): Promise<ChannelWithMembers> {
  const res = await api.patch<{ data: ChannelWithMembers }>(`/api/admin/channels/${id}`, body);
  return res.data;
}

export async function deleteChannel(id: string): Promise<void> {
  await api.delete(`/api/admin/channels/${id}`);
}

export async function replaceChannelMembers(
  id: string,
  body: ReplaceChannelMembersRequest,
): Promise<ChannelWithMembers> {
  const res = await api.post<{ data: ChannelWithMembers }>(
    `/api/admin/channels/${id}/members/replace`,
    body,
  );
  return res.data;
}
