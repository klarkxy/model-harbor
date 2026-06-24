import { api } from '../client.js';
import type {
  SetupStatusResponse,
  SetupSecurityRequest,
  SetupSecurityResponse,
  SetupUpstreamRequest,
  SetupUpstreamResponse,
  SetupModelsRequest,
  SetupModelsResponse,
  SetupConsumerKeyResponse,
  SetupTestRequestResponse,
  SetupTestRequestQuery,
} from '@manageyourllm/contracts';

export async function getSetupStatus(): Promise<SetupStatusResponse['data']> {
  const res = await api.get<SetupStatusResponse>('/api/admin/setup/status');
  return res.data;
}

export async function verifySetupSecurity(body: SetupSecurityRequest): Promise<SetupSecurityResponse['data']> {
  const res = await api.post<SetupSecurityResponse>('/api/admin/setup/security', body);
  return res.data;
}

export async function setupUpstream(body: SetupUpstreamRequest): Promise<SetupUpstreamResponse['data']> {
  const res = await api.post<SetupUpstreamResponse>('/api/admin/setup/upstream', body);
  return res.data;
}

export async function setupModels(body: SetupModelsRequest): Promise<SetupModelsResponse['data']> {
  const res = await api.post<SetupModelsResponse>('/api/admin/setup/models', body);
  return res.data;
}

export async function setupConsumerKey(): Promise<SetupConsumerKeyResponse['data']> {
  const res = await api.post<SetupConsumerKeyResponse>('/api/admin/setup/consumer-key');
  return res.data;
}

export async function getSetupTestRequest(query: SetupTestRequestQuery): Promise<SetupTestRequestResponse['data']> {
  const params = new URLSearchParams({ model: query.model });
  const res = await api.get<SetupTestRequestResponse>(`/api/admin/setup/test-request?${params.toString()}`);
  return res.data;
}
