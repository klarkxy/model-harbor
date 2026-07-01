import { api } from '../client.js';
import type {
  CircuitBreakerContract,
  StickyBindingContract,
  StickySessionContract,
} from '@manageyourllm/contracts';

export async function listBreakers(): Promise<CircuitBreakerContract[]> {
  const res = await api.get<{ data: CircuitBreakerContract[] }>('/api/admin/resilience/breakers');
  return res.data;
}

export async function resetBreaker(
  providerAccountId: string,
  realModelName: string,
  // 收口 #3：breaker 严格绑定 endpoint，调用方必须传 endpointId。
  endpointId: string,
): Promise<CircuitBreakerContract> {
  const encoded = encodeURIComponent(realModelName);
  const res = await api.post<{ data: CircuitBreakerContract }>(
    `/api/admin/resilience/breakers/${providerAccountId}/${encoded}/reset?endpointId=${encodeURIComponent(endpointId)}`,
    {},
  );
  return res.data;
}

export interface StickyOverview {
  bindings: StickyBindingContract[];
  sessions: StickySessionContract[];
}

export async function getStickyOverview(query?: {
  clientKeyId?: string;
  requestedTargetName?: string;
}): Promise<StickyOverview> {
  const params = new URLSearchParams();
  if (query?.clientKeyId) params.set('clientKeyId', query.clientKeyId);
  if (query?.requestedTargetName) params.set('requestedTargetName', query.requestedTargetName);
  const qs = params.toString();
  const res = await api.get<{ data: StickyOverview }>(
    `/api/admin/resilience/sticky${qs ? `?${qs}` : ''}`,
  );
  return res.data;
}
