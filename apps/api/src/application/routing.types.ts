import type { ChatRequestIR, SourceProtocol } from '@manageyourllm/shared';
import type { ProviderType } from '@manageyourllm/shared';
import type { ProviderAccountRow } from '../infrastructure/db/schema.js';
import type { ResolvedTarget } from './target-resolution.service.js';

// ============================================================================
// Snapshot 类型（v1 Routing：construct once, filter in memory）
// ----------------------------------------------------------------------------
// 路由决策链路不长期持有 DB row。所有候选行 / 配置 / breaker / sticky 状态在
// decide() 入口一次性读取，转成下面的 Snapshot，之后的过滤 / 排序 / sticky
// 匹配全部基于内存 Snapshot，不再访问数据库。
// ============================================================================

// v1 路由持有账号 row 完整字段；secret (apiKeyCiphertext) 仍由 gateway-execution
// 阶段用 candidate.providerAccount.id 现取解密凭据，不在路由链路消费。
export type ProviderAccountSnapshot = ProviderAccountRow;

export interface EndpointSnapshot {
  id: string;
  providerAccountId: string;
  protocol: SourceProtocol;
  baseUrl: string;
  path: string | null;
  providerType: ProviderType;
  capabilities: unknown[];
  enabled: boolean;
  displayOrder: number;
}

export interface CandidateSnapshot {
  id: string;
  modelId: string;
  channelMemberId?: string;
  providerAccount: ProviderAccountSnapshot;
  endpoint: EndpointSnapshot;
  realModelName: string;
  endpointUrl: string;
  endpointProtocol: SourceProtocol;
  providerType: ProviderType;
  priority: number;
  enabled: boolean;
  protocolConversion: 'native' | 'convertible' | 'unsupported';
}

export interface RoutingSettingsSnapshot {
  enableStickySession: boolean;
  enableCircuitBreaker: boolean;
  publicBaseUrl: string | null;
  circuitBreakerBaseCooldownMs: number;
  circuitBreakerMaxCooldownMs: number;
  circuitBreakerHalfOpenSuccessCount: number;
  stickySessionTtlMs: number;
  firstTokenTimeoutMs: number;
  defaultRequestTimeoutMs: number;
  defaultRetries: number;
}

export interface TraceEvent {
  step: string;
  status: 'ok' | 'drop' | 'fail' | 'info';
  details?: Record<string, unknown>;
}

export interface RoutingDecision {
  requestedModel: string;
  resolvedTargetType: 'model' | 'channel';
  resolvedTargetId: string;
  resolvedTargetName: string;
  candidates: CandidateSnapshot[];
  stickyHit: boolean;
  sessionStickyHit: boolean;
  conversationFingerprint: string;
  traceEvents: TraceEvent[];
}

export interface RoutingDecisionInput {
  ir: ChatRequestIR;
  resolvedTarget: ResolvedTarget;
  clientKeyId: string;
  clientId: string;
  settings: RoutingSettingsSnapshot;
  now: Date;
}
