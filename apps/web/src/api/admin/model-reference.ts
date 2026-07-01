import { api } from '../client.js';
import type {
  ModelReferenceEntryContract,
  ModelReferenceSyncStatusContract,
  RefreshModelReferenceRequest,
  RecommendModelReferenceRequest,
} from '@manageyourllm/contracts';

export async function listModelReferenceEntries(
  query?: Record<string, string>,
): Promise<ModelReferenceEntryContract[]> {
  const qs = query ? new URLSearchParams(query).toString() : '';
  const res = await api.get<{ data: ModelReferenceEntryContract[]; total?: number }>(
    `/api/admin/model-reference${qs ? `?${qs}` : ''}`,
  );
  return res.data;
}

export async function getModelReferenceSyncStatus(): Promise<ModelReferenceSyncStatusContract | null> {
  const res = await api.get<{ data: ModelReferenceSyncStatusContract | null }>(
    '/api/admin/model-reference/sync-status',
  );
  return res.data;
}

export async function refreshModelReference(
  body?: RefreshModelReferenceRequest,
): Promise<{ success: boolean; error?: string | null }> {
  const res = await api.post<{ data: { success: boolean; error?: string | null } }>(
    '/api/admin/model-reference/refresh',
    body ?? {},
  );
  return res.data;
}

export async function recommendModelReferenceDraft(body: RecommendModelReferenceRequest) {
  const res = await api.post<{
    data: {
      models: Array<{
        name: string;
        displayName: string;
        description: string;
        candidates: Array<{
          providerAccountId: string;
          endpointId: string;
          realModelName: string;
          priority: number;
          enabled: boolean;
        }>;
        nameConflict: boolean;
      }>;
      channel?: {
        name: string;
        displayName: string;
        description: string;
        members: Array<{
          modelName: string;
          priority: number;
          enabled: boolean;
        }>;
        nameConflict: boolean;
      };
      conflicts: string[];
    };
  }>('/api/admin/model-reference/recommend', body);
  return res.data;
}
