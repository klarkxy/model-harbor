import type { ProviderType, SourceProtocol } from '@manageyourllm/shared';
import { protocolFor } from '@manageyourllm/shared';
import type {
  AdminSettingsRow,
  EndpointRow,
  ModelCandidateRow,
  ProviderAccountRow,
} from '../infrastructure/db/schema.js';
import type {
  CandidateSnapshot,
  EndpointSnapshot,
  ProviderAccountSnapshot,
  RoutingSettingsSnapshot,
} from './routing.types.js';

/**
 * Provider Account row → Snapshot。
 *
 * v1 阶段为减少 Slice 4 改字段名的爆炸面，snapshot 直接保留 row 全部字段（除了
 * 未来如果发现真不需要再剔除）。Slice 4 收口后再决定哪些字段真正进 routing 路径。
 *
 * 注意：snapshot 阶段不做解密；secret (apiKeyCiphertext) 仍由 gateway-execution
 * 阶段用 candidate.providerAccount.id 现取解密凭据。
 */
export function mapProviderAccountToSnapshot(row: ProviderAccountRow): ProviderAccountSnapshot {
  return row;
}

export function mapEndpointToSnapshot(row: EndpointRow): EndpointSnapshot {
  return {
    id: row.id,
    providerAccountId: row.providerAccountId,
    protocol: (row.protocol as SourceProtocol) ?? protocolFor(row.providerType as ProviderType),
    baseUrl: row.baseUrl,
    path: row.path,
    providerType: row.providerType as ProviderType,
    capabilities: row.capabilitiesJson ?? [],
    enabled: row.enabled,
    displayOrder: row.displayOrder,
  };
}

export function mapSettingsRowToSnapshot(row: AdminSettingsRow): RoutingSettingsSnapshot {
  return {
    enableStickySession: row.enableStickySession ?? true,
    enableCircuitBreaker: row.enableCircuitBreaker ?? true,
    publicBaseUrl: row.publicBaseUrl ?? null,
    circuitBreakerBaseCooldownMs: row.circuitBreakerBaseCooldownMs ?? 60_000,
    circuitBreakerMaxCooldownMs: row.circuitBreakerMaxCooldownMs ?? 600_000,
    circuitBreakerHalfOpenSuccessCount: row.circuitBreakerHalfOpenSuccessCount ?? 2,
    stickySessionTtlMs: 5 * 60 * 1000,
    firstTokenTimeoutMs: row.firstTokenTimeoutMs ?? 15_000,
    defaultRequestTimeoutMs: row.defaultRequestTimeoutMs ?? 30_000,
    defaultRetries: row.defaultRetries ?? 0,
  };
}

export function buildEndpointUrl(
  candidateEndpointUrl: string | null | undefined,
  endpoint: EndpointSnapshot,
): string {
  if (candidateEndpointUrl) return candidateEndpointUrl;
  // 只返回 base URL（不包含 path）；path 由适配器通过 endpointPath 上下文单独处理，
  // 避免端点的 path 与适配器硬编码的 API 路径（/v1/chat/completions 等）重复拼接。
  return endpoint.baseUrl.replace(/\/$/, '');
}

export interface BuildCandidateInput {
  candidate: ModelCandidateRow;
  provider: ProviderAccountSnapshot;
  endpoint: EndpointSnapshot;
  protocolConversion: 'native' | 'convertible' | 'unsupported';
  channelMemberId?: string;
}

export function buildCandidateSnapshot(input: BuildCandidateInput): CandidateSnapshot {
  const endpointUrl = buildEndpointUrl(input.candidate.endpointUrl, input.endpoint);
  return {
    id: input.candidate.id,
    modelId: input.candidate.modelId,
    channelMemberId: input.channelMemberId,
    providerAccount: input.provider,
    endpoint: input.endpoint,
    realModelName: input.candidate.realModelName,
    endpointUrl,
    endpointProtocol: input.endpoint.protocol,
    providerType: input.endpoint.providerType,
    priority: input.candidate.priority,
    enabled: input.candidate.enabled,
    protocolConversion: input.protocolConversion,
  };
}
