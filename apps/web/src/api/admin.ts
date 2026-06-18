import { api } from './client.js';

// Upstream keys
export interface UpstreamKeyQuota {
  period: 'hour' | 'day' | 'week' | 'month' | 'total';
  requestLimit: number | null;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
  totalTokenLimit: number | null;
  enabled: boolean;
}

export interface UpstreamKey {
  id: string;
  name: string;
  providerType: 'anthropic_compatible' | 'openai_compatible';
  baseUrl: string;
  apiKeyPrefix: string;
  defaultHeaders: Record<string, string>;
  supportedModels: string[];
  candidateCount: number;
  endpoints?: ProviderPresetEndpoint[];
  providerPresetId: string | null;
  enabled: boolean;
  frozen: boolean;
  frozenReason: string | null;
  cooldownUntil: string | null;
  lastHealthStatus: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  quota: UpstreamKeyQuota | null;
}

export interface UpstreamKeyCandidate {
  id: string;
  publicModelId: string;
  publicName: string;
  realName: string;
  enabled: boolean;
  priority: number;
  weight: number;
}

export interface UpstreamKeyCreatePayload {
  name: string;
  providerType?: 'anthropic_compatible' | 'openai_compatible';
  baseUrl?: string;
  apiKey: string;
  supportedModels?: string[];
  defaultHeaders?: Record<string, string>;
  providerPresetId?: string;
  modelMappings?: Array<{ realName: string; publicName?: string; enabled?: boolean }>;
  quota?: {
    period: 'hour' | 'day' | 'week' | 'month' | 'total';
    requestLimit?: number;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    totalTokenLimit?: number;
  };
}

export interface DiscoverModelsPayload {
  baseUrl: string;
  apiKey?: string;
  providerType: 'anthropic_compatible' | 'openai_compatible';
  providerPresetId?: string;
  upstreamKeyId?: string;
}

export const upstreamKeysApi = {
  list: () => api.get<{ items: UpstreamKey[] }>('/api/admin/upstream-keys'),
  get: (id: string) => api.get<UpstreamKey>(`/api/admin/upstream-keys/${id}`),
  create: (payload: UpstreamKeyCreatePayload) =>
    api.post<UpstreamKey>('/api/admin/upstream-keys', payload),
  discoverModels: (payload: DiscoverModelsPayload) =>
    api.post<{ items: Array<{ realName: string; publicName: string }> }>(
      '/api/admin/upstream-keys/discover-models',
      payload,
    ),
  update: (id: string, payload: Partial<UpstreamKeyCreatePayload> & { enabled?: boolean }) =>
    api.patch<UpstreamKey>(`/api/admin/upstream-keys/${id}`, payload),
  getCandidates: (id: string) =>
    api.get<{ items: UpstreamKeyCandidate[] }>(`/api/admin/upstream-keys/${id}/candidates`),
  setCandidates: (
    id: string,
    mappings: Array<{ realName: string; publicName?: string; enabled?: boolean }>,
  ) =>
    api.put<{ items: UpstreamKeyCandidate[] }>(`/api/admin/upstream-keys/${id}/candidates`, {
      mappings,
    }),
  freeze: (id: string, reason?: string) =>
    api.post<{ id: string; frozen: boolean; frozenReason: string }>(
      `/api/admin/upstream-keys/${id}/freeze`,
      reason ? { reason } : {},
    ),
  unfreeze: (id: string) =>
    api.post<{ id: string; frozen: boolean }>(`/api/admin/upstream-keys/${id}/unfreeze`),
  rotateSecret: (id: string, newApiKey: string) =>
    api.post<{ id: string; apiKeyPrefix: string }>(`/api/admin/upstream-keys/${id}/rotate-secret`, {
      apiKey: newApiKey,
    }),
  delete: (id: string) =>
    api.delete<{ id: string; deleted: boolean }>(`/api/admin/upstream-keys/${id}`),
};

// Provider presets
export interface ProviderPresetEndpoint {
  protocol: 'anthropic' | 'openai';
  baseUrl: string;
  providerType: 'anthropic_compatible' | 'openai_compatible';
  apiPath?: string;
}

export interface ProviderPreset {
  id: string;
  icon?: string;
  name: string;
  endpoints: ProviderPresetEndpoint[];
  modelMappings: Array<{ publicName: string; realName: string }>;
  defaultHeaders?: Record<string, string>;
}

export const providerPresetsApi = {
  list: () => api.get<{ items: ProviderPreset[] }>('/api/admin/provider-presets'),
};

// Public models
export interface PublicModelCandidate {
  id: string;
  upstreamKeyId: string;
  realModelName: string;
  priority: number;
  weight: number;
  enabled: boolean;
  upstreamKey: {
    id: string;
    name: string;
    providerType: string;
    enabled: boolean;
    frozen: boolean;
  } | null;
}

export interface PublicModel {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  enabled: boolean;
  candidateCount: number;
  createdAt: string;
  updatedAt: string;
  candidates?: PublicModelCandidate[];
}

export interface PublicModelCreatePayload {
  name: string;
  displayName?: string;
  description?: string;
  candidates?: Array<{
    upstreamKeyId: string;
    realModelName: string;
    priority?: number;
    weight?: number;
    enabled?: boolean;
  }>;
}

export const publicModelsApi = {
  list: () => api.get<{ items: PublicModel[] }>('/api/admin/public-models'),
  get: (id: string) => api.get<PublicModel>(`/api/admin/public-models/${id}`),
  create: (payload: PublicModelCreatePayload) =>
    api.post<PublicModel>('/api/admin/public-models', payload),
  setCandidates: (id: string, candidates: PublicModelCreatePayload['candidates']) =>
    api.put<{ candidates: PublicModelCandidate[] }>(`/api/admin/public-models/${id}/candidates`, {
      candidates: candidates ?? [],
    }),
  remove: (id: string) =>
    api.delete<{ id: string; deleted: boolean }>(`/api/admin/public-models/${id}`),
};

// Model groups
export interface ModelGroupMember {
  id: string;
  publicModelId: string;
  publicModelName: string | null;
  priority: number;
  weight: number;
  enabled: boolean;
}

export interface ModelGroup {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  enabled: boolean;
  routingPolicy: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  members?: ModelGroupMember[];
}

export interface ModelGroupCreatePayload {
  name: string;
  displayName?: string;
  description?: string;
  members?: Array<{
    publicModelId: string;
    priority?: number;
    weight?: number;
    enabled?: boolean;
  }>;
}

export const modelGroupsApi = {
  list: () => api.get<{ items: ModelGroup[] }>('/api/admin/model-groups'),
  get: (id: string) => api.get<ModelGroup>(`/api/admin/model-groups/${id}`),
  create: (payload: ModelGroupCreatePayload) =>
    api.post<ModelGroup>('/api/admin/model-groups', payload),
  setMembers: (id: string, members: ModelGroupCreatePayload['members']) =>
    api.put<{ members: ModelGroupMember[] }>(`/api/admin/model-groups/${id}/members`, {
      members: members ?? [],
    }),
  remove: (id: string) =>
    api.delete<{ id: string; deleted: boolean }>(`/api/admin/model-groups/${id}`),
};

// Apps
export interface AppSummary {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppCreatePayload {
  name: string;
  description?: string;
}

export const appsApi = {
  list: () => api.get<{ items: AppSummary[] }>('/api/admin/apps'),
  get: (id: string) => api.get<AppSummary>(`/api/admin/apps/${id}`),
  create: (payload: AppCreatePayload) => api.post<AppSummary>('/api/admin/apps', payload),
  update: (id: string, payload: Partial<AppCreatePayload> & { enabled?: boolean }) =>
    api.patch<AppSummary>(`/api/admin/apps/${id}`, payload),
};

// Consumer keys
export interface ConsumerKeyAccessItem {
  targetType: 'public_model' | 'model_group';
  targetId: string;
}

export interface ConsumerKey {
  id: string;
  appId: string;
  name: string;
  keyPrefix: string;
  enabled: boolean;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // raw key is only present on create / rotate
  key?: string;
}

export interface ConsumerKeyCreatePayload {
  name: string;
  access?: ConsumerKeyAccessItem[];
}

export const consumerKeysApi = {
  list: (appId: string) =>
    api.get<{ items: ConsumerKey[] }>(`/api/admin/apps/${appId}/consumer-keys`),
  create: (appId: string, payload: ConsumerKeyCreatePayload) =>
    api.post<ConsumerKey>(`/api/admin/apps/${appId}/consumer-keys`, payload),
  revoke: (id: string) => api.post<ConsumerKey>(`/api/admin/consumer-keys/${id}/revoke`),
  rotate: (id: string) => api.post<ConsumerKey>(`/api/admin/consumer-keys/${id}/rotate`),
  setAccess: (id: string, access: ConsumerKeyAccessItem[]) =>
    api.put<{ access: ConsumerKeyAccessItem[] }>(`/api/admin/consumer-keys/${id}/access`, {
      access,
    }),
};

// Usage / observability (M7 dashboard)
export type UsageWindow = 'today' | '24h' | '7d';

export interface UsageTotals {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  stickyHits: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  successRate: number;
  stickyHitRate: number;
}

export interface UsageBreakdownEntry {
  id: string;
  name: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageTargetBreakdownEntry extends UsageBreakdownEntry {
  targetType: 'public_model' | 'model_group';
}

export interface UsageRecentRow {
  id: string;
  appId: string;
  consumerKeyId: string;
  requestedTargetName: string;
  resolvedTargetType: 'public_model' | 'model_group';
  resolvedTargetId: string;
  upstreamKeyId: string;
  realModelName: string;
  sourceProtocol: string;
  stream: boolean;
  stickyHit: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  status: 'success' | 'error';
  errorCode: string | null;
  latencyMs: number;
  createdAt: string;
}

export const usageApi = {
  totals: (window: UsageWindow = 'today') =>
    api.get<UsageTotals>(`/api/admin/usage/totals?window=${window}`),
  byApp: (window: UsageWindow = 'today') =>
    api.get<{ items: UsageBreakdownEntry[] }>(`/api/admin/usage/by-app?window=${window}`),
  byConsumerKey: (window: UsageWindow = 'today') =>
    api.get<{ items: UsageBreakdownEntry[] }>(`/api/admin/usage/by-consumer-key?window=${window}`),
  byUpstreamKey: (window: UsageWindow = 'today') =>
    api.get<{ items: UsageBreakdownEntry[] }>(`/api/admin/usage/by-upstream-key?window=${window}`),
  byTarget: (window: UsageWindow = 'today') =>
    api.get<{ items: UsageTargetBreakdownEntry[] }>(`/api/admin/usage/by-target?window=${window}`),
  recent: (limit = 100) =>
    api.get<{ items: UsageRecentRow[] }>(`/api/admin/usage/recent?limit=${limit}`),
};

// Audit (post-M7 hardening)
export interface AuditEvent {
  id: string;
  actorAdminId: string | null;
  actorUsername: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export const auditApi = {
  list: (limit = 100) => api.get<{ items: AuditEvent[] }>(`/api/admin/audit-events?limit=${limit}`),
};

// Account self-service (Settings page)
export const accountApi = {
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true }>('/api/admin/auth/change-password', { currentPassword, newPassword }),
  updateProfile: (payload: { displayName?: string | null }) =>
    api.patch<{ admin: AdminSummary }>('/api/admin/auth/profile', payload),
};

export interface AdminSummary {
  id: string;
  username: string;
  displayName: string | null;
}
