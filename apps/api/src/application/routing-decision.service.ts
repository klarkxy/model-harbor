import type {
  CandidateSnapshot,
  RoutingDecision,
  RoutingDecisionInput,
  TraceEvent,
} from './routing.types.js';
import { ModelRepository } from '../infrastructure/db/repositories/model.repository.js';
import { ChannelRepository } from '../infrastructure/db/repositories/channel.repository.js';
import { ProviderAccountRepository } from '../infrastructure/db/repositories/provider-account.repository.js';
import { EndpointRepository } from '../infrastructure/db/repositories/endpoint.repository.js';
import { RoutingStateRepository } from '../infrastructure/db/repositories/routing-state.repository.js';
import { computeConversationFingerprint } from '../domain/gateway/conversation-fingerprint.js';
import {
  endpointProtocolCompatibility,
  periodBounds,
  providerSupportsCapability,
  requestRequiresAdvancedCrossProtocol,
  requiredCapabilities,
  type RoutingProviderType,
} from '../domain/gateway/routing-policy.js';
import type { RequiredCapabilities } from '@manageyourllm/shared';
import {
  buildCandidateSnapshot,
  buildEndpointUrl,
  mapEndpointToSnapshot,
  mapProviderAccountToSnapshot,
} from './snapshots.js';

/**
 * RoutingDecisionService
 *
 * 路由决策入口：基于 requested model 名称解析候选候选、过滤、决定尝试顺序。
 *
 * v1 重构：
 * - 不再持有 DB row；候选以 CandidateSnapshot 形式流转。
 * - 不再做"candidate × endpoint 笛卡尔积"展开（v1 candidate 严格绑定 endpoint）。
 * - 不再按 endpointHealth.delayMs / degraded 自动重排（v1 只按用户显式 priority + native 优先）。
 * - disabled endpoint / disabled candidate / endpoint capability 不满足三种 filter 全部消费。
 */
export class RoutingDecisionService {
  constructor(
    private readonly modelRepo: ModelRepository,
    private readonly channelRepo: ChannelRepository,
    private readonly providerAccountRepo: ProviderAccountRepository,
    private readonly routingStateRepo: RoutingStateRepository,
    private readonly endpointRepo: EndpointRepository,
  ) {}

  async decide(input: RoutingDecisionInput): Promise<RoutingDecision> {
    const { ir, resolvedTarget, clientKeyId, clientId, settings, now } = input;
    const fingerprint = computeConversationFingerprint(ir);
    const events: TraceEvent[] = [];

    events.push({
      step: 'candidates_expand',
      status: 'info',
      details: { targetType: resolvedTarget.type, targetName: resolvedTarget.name },
    });

    // 第一阶段：构建候选 Snapshot（一次集中 IO）。
    let candidates: CandidateSnapshot[] = [];
    if (resolvedTarget.type === 'model') {
      candidates = await this.expandModel(resolvedTarget.id, ir, events);
    } else {
      candidates = await this.expandChannel(resolvedTarget.id, ir, events);
    }

    events.push({
      step: 'candidates_filter',
      status: 'info',
      details: { before: candidates.length },
    });

    // 第二阶段：纯内存过滤。
    const filtered = await this.filterCandidates(candidates, ir, settings, now, events);

    // 第三阶段：native > convertible 一级排序（v1 文档 TODO 228 要求）。
    const sorted = this.sortCandidates(filtered, ir);

    const finalCandidates = sorted;
    let stickyHit = false;
    let sessionStickyHit = false;

    if (settings.enableStickySession) {
      const binding = await this.routingStateRepo.findStickyBinding(
        clientId,
        clientKeyId,
        ir.requestedModel,
        fingerprint,
        now,
      );
      if (binding) {
        const matchIndex = finalCandidates.findIndex((c) => stickyMatchesSnapshot(binding, c));
        if (matchIndex > 0) {
          const match = finalCandidates.splice(matchIndex, 1)[0];
          if (match) {
            finalCandidates.unshift(match);
            stickyHit = true;
            events.push({
              step: 'sticky_binding_hit',
              status: 'ok',
              details: { providerAccountId: binding.providerAccountId },
            });
          }
        } else if (matchIndex === 0) {
          stickyHit = true;
        }
      }

      if (!stickyHit) {
        const session = await this.routingStateRepo.findStickySession(
          clientKeyId,
          ir.requestedModel,
          now,
        );
        if (session) {
          const matchIndex = finalCandidates.findIndex((c) => stickyMatchesSnapshot(session, c));
          if (matchIndex > 0) {
            const match = finalCandidates.splice(matchIndex, 1)[0];
            if (match) {
              finalCandidates.unshift(match);
              sessionStickyHit = true;
              events.push({
                step: 'sticky_session_hit',
                status: 'ok',
                details: { providerAccountId: session.providerAccountId },
              });
            }
          } else if (matchIndex === 0) {
            sessionStickyHit = true;
          }
        }
      }
    }

    events.push({
      step: 'routing_decision',
      status: 'ok',
      details: { after: finalCandidates.length },
    });

    return {
      requestedModel: ir.requestedModel,
      resolvedTargetType: resolvedTarget.type,
      resolvedTargetId: resolvedTarget.id,
      resolvedTargetName: resolvedTarget.name,
      candidates: finalCandidates,
      stickyHit,
      sessionStickyHit,
      conversationFingerprint: fingerprint,
      traceEvents: events,
    };
  }

  // -------------------------------------------------------------------------
  // 第一阶段：expand
  // -------------------------------------------------------------------------

  private async expandModel(
    modelId: string,
    ir: RoutingDecisionInput['ir'],
    events: TraceEvent[],
  ): Promise<CandidateSnapshot[]> {
    const model = await this.modelRepo.findById(modelId);
    if (!model || !model.enabled) {
      events.push({
        step: 'filter_model_disabled',
        status: 'drop',
        details: { modelId },
      });
      return [];
    }
    const candidateRows = await this.modelRepo.listCandidates(modelId);
    return this.buildCandidates(candidateRows, ir);
  }

  private async expandChannel(
    channelId: string,
    ir: RoutingDecisionInput['ir'],
    events: TraceEvent[],
  ): Promise<CandidateSnapshot[]> {
    const channel = await this.channelRepo.findById(channelId);
    if (!channel || !channel.enabled) {
      events.push({
        step: 'filter_channel_disabled',
        status: 'drop',
        details: { channelId },
      });
      return [];
    }
    const members = await this.channelRepo.listMembers(channelId);
    const enabledMembers = members.filter((m) => m.enabled);
    if (enabledMembers.length === 0) return [];

    // v1 Channel 不做 weighted / round-robin：按 priority 升序稳定排序。
    const selectedMembers = enabledMembers.slice().sort((a, b) => a.priority - b.priority);

    const result: CandidateSnapshot[] = [];
    for (const member of selectedMembers) {
      const candidateRows = await this.modelRepo.listCandidates(member.modelId);
      const built = await this.buildCandidates(candidateRows, ir);
      for (const c of built) {
        result.push({ ...c, channelMemberId: member.id });
      }
    }
    return result;
  }

  /**
   * candidate row + endpoint 反查 → CandidateSnapshot。
   * v1 candidate 已通过 endpointId FK 绑定 endpoint，不再做笛卡尔积。
   */
  private async buildCandidates(
    candidateRows: Awaited<ReturnType<ModelRepository['listCandidates']>>,
    ir: RoutingDecisionInput['ir'],
  ): Promise<CandidateSnapshot[]> {
    if (candidateRows.length === 0) return [];

    // 批量获取所有 provider account 和 endpoint（避免 N+1）。
    const accountIds = Array.from(new Set(candidateRows.map((r) => r.providerAccountId)));
    const endpointIds = Array.from(new Set(candidateRows.map((r) => r.endpointId)));
    const [accounts, endpoints] = await Promise.all([
      this.providerAccountRepo.findByIds(accountIds),
      this.endpointRepo.findByIds(endpointIds),
    ]);

    const result: CandidateSnapshot[] = [];
    for (const row of candidateRows) {
      const accountRow = accounts.get(row.providerAccountId);
      if (!accountRow) continue;
      const endpointRow = endpoints.get(row.endpointId);
      if (!endpointRow) continue;
      const provider = mapProviderAccountToSnapshot(accountRow);
      const endpoint = mapEndpointToSnapshot(endpointRow);

      // 预计算 protocolConversion —— 后续 filter / sort 都读 snapshot。
      const protocolConversion = endpointProtocolCompatibility(
        endpoint.protocol,
        ir.sourceProtocol,
      );
      result.push(
        buildCandidateSnapshot({
          candidate: row,
          provider,
          endpoint,
          protocolConversion,
        }),
      );
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // 第二阶段：filter
  // -------------------------------------------------------------------------

  private async filterCandidates(
    candidates: CandidateSnapshot[],
    ir: RoutingDecisionInput['ir'],
    settings: RoutingDecisionInput['settings'],
    now: Date,
    events: TraceEvent[],
  ): Promise<CandidateSnapshot[]> {
    const required = requiredCapabilities(ir.rawRequest);
    const result: CandidateSnapshot[] = [];

    for (const c of candidates) {
      const provider = c.providerAccount;

      if (!provider.enabled) {
        events.push({
          step: 'filter_disabled',
          status: 'drop',
          details: { providerAccountId: provider.id },
        });
        continue;
      }
      if (provider.frozen) {
        events.push({
          step: 'filter_frozen',
          status: 'drop',
          details: { providerAccountId: provider.id },
        });
        continue;
      }

      if (!c.endpoint.enabled) {
        events.push({
          step: 'filter_endpoint_disabled',
          status: 'drop',
          details: { providerAccountId: provider.id, endpointId: c.endpoint.id },
        });
        continue;
      }
      if (!c.enabled) {
        events.push({
          step: 'filter_candidate_disabled',
          status: 'drop',
          details: {
            providerAccountId: provider.id,
            endpointId: c.endpoint.id,
            candidateId: c.id,
          },
        });
        continue;
      }

      // 协议兼容性。
      if (c.protocolConversion === 'unsupported') {
        events.push({
          step: 'filter_protocol_unsupported',
          status: 'drop',
          details: {
            providerAccountId: provider.id,
            endpointProtocol: c.endpointProtocol,
            sourceProtocol: ir.sourceProtocol,
          },
        });
        continue;
      }
      if (c.protocolConversion === 'convertible') {
        events.push({
          step: 'filter_protocol_convertible',
          status: 'info',
          details: {
            providerAccountId: provider.id,
            endpointProtocol: c.endpointProtocol,
            sourceProtocol: ir.sourceProtocol,
          },
        });
      }
      if (
        c.protocolConversion === 'convertible' &&
        requestRequiresAdvancedCrossProtocol(ir.rawRequest)
      ) {
        events.push({
          step: 'filter_protocol_advanced_unsupported',
          status: 'drop',
          details: {
            providerAccountId: provider.id,
            endpointProtocol: c.endpointProtocol,
            sourceProtocol: ir.sourceProtocol,
            reason: 'advanced capabilities are not supported across protocols yet',
          },
        });
        continue;
      }

      // endpoint capability 检查：endpoint.capabilities 必须满足 requiredCapabilities。
      const { satisfied, remaining } = this.partitionCapabilities(
        c.endpoint.capabilities,
        required,
      );
      if (!satisfied) {
        events.push({
          step: 'filter_endpoint_capability',
          status: 'drop',
          details: {
            providerAccountId: provider.id,
            endpointId: c.endpoint.id,
            required,
          },
        });
        continue;
      }

      // provider 类型 capability（向后兼容：基于 providerType 对 endpoint 未覆盖的能力做推断）。
      if (!this.matchesCapabilities(c.providerType as RoutingProviderType, remaining)) {
        events.push({
          step: 'filter_capability',
          status: 'drop',
          details: { providerAccountId: provider.id, required },
        });
        continue;
      }

      // breaker / cooldown —— v1 candidate 已绑定 endpoint，用 provider+endpoint+model 粒度。
      if (settings.enableCircuitBreaker) {
        const breaker = await this.routingStateRepo.findBreaker(
          provider.id,
          c.endpoint.id,
          c.realModelName,
        );
        if (breaker) {
          // cooldownUntil 独立于 state：即使是 closed 行，只要仍处冷却期就跳过。
          if (breaker.cooldownUntil && breaker.cooldownUntil > now) {
            events.push({
              step: breaker.state === 'open' ? 'filter_breaker_open' : 'filter_cooldown',
              status: 'drop',
              details: {
                providerAccountId: provider.id,
                endpointId: c.endpoint.id,
                realModelName: c.realModelName,
                state: breaker.state,
              },
            });
            continue;
          }

          if (breaker.state === 'open') {
            events.push({
              step: 'filter_breaker_half_open',
              status: 'ok',
              details: { providerAccountId: provider.id, endpointId: c.endpoint.id },
            });
            await this.routingStateRepo.updateBreakerState(
              provider.id,
              c.endpoint.id,
              c.realModelName,
              'half_open',
              { cooldownUntil: null },
            );
          }
        }
      }

      // quota 检查（基于 account 维度）。
      if (await this.quotaExhausted(provider.id, now)) {
        events.push({
          step: 'filter_quota',
          status: 'drop',
          details: { providerAccountId: provider.id },
        });
        continue;
      }

      result.push(c);
    }

    return result;
  }

  /**
   * 基于 endpoint.capabilities 对 required 做分区：
   * - satisfied: endpoint 显式声明的能力是否覆盖所有 required。
   * - remaining: endpoint 未覆盖、需要 providerType 推断的能力维度。
   * 当 endpoint.capabilities 为空时跳过（向后兼容：等价于"未声明，沿用 providerType 推断"）。
   */
  private partitionCapabilities(
    endpointCapabilities: unknown[],
    required: ReturnType<typeof requiredCapabilities>,
  ): { satisfied: boolean; remaining: ReturnType<typeof requiredCapabilities> } {
    if (!Array.isArray(endpointCapabilities) || endpointCapabilities.length === 0) {
      return { satisfied: true, remaining: required };
    }
    const caps = new Set(endpointCapabilities.map((c) => String(c)));
    const remaining = { ...required } as Record<string, boolean>;
    let satisfied = true;
    for (const [key, value] of Object.entries(required)) {
      if (!value) continue;
      if (caps.has(key)) {
        remaining[key] = false;
      } else {
        satisfied = false;
      }
    }
    return { satisfied, remaining: remaining as ReturnType<typeof requiredCapabilities> };
  }

  private matchesCapabilities(
    providerType: RoutingProviderType,
    required: ReturnType<typeof requiredCapabilities>,
  ): boolean {
    for (const [key, value] of Object.entries(required)) {
      if (!value) continue;
      if (!providerSupportsCapability(providerType, key as keyof RequiredCapabilities)) {
        return false;
      }
    }
    return true;
  }

  private async quotaExhausted(providerAccountId: string, now: Date): Promise<boolean> {
    const quota = await this.providerAccountRepo.findQuotaByProviderAccount(providerAccountId);
    if (!quota || !quota.enabled) return false;

    // v1 简化：只查 hour 周期。其它周期由 usage service 异步聚合。
    const hourStart = periodBounds('hour', now).startedAt;
    const counter = await this.providerAccountRepo.findCounter(
      providerAccountId,
      'hour',
      hourStart,
    );
    if (counter) {
      if (quota.requestLimit != null && counter.requestCount >= quota.requestLimit) return true;
      if (quota.inputTokenLimit != null && counter.inputTokens >= quota.inputTokenLimit)
        return true;
      if (quota.outputTokenLimit != null && counter.outputTokens >= quota.outputTokenLimit)
        return true;
      if (quota.totalTokenLimit != null && counter.totalTokens >= quota.totalTokenLimit)
        return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // 第三阶段：sort（只剩 native > convertible 一级）
  // -------------------------------------------------------------------------

  private sortCandidates(
    candidates: CandidateSnapshot[],
    _ir: RoutingDecisionInput['ir'],
  ): CandidateSnapshot[] {
    // v1 排序规则：
    // 1. priority 升序（用户显式顺序）。
    // 2. priority 相同时 native > convertible。
    // 3. 完全相同时 id 字典序稳定 tie-breaker。
    // v1 明确不做：endpointHealth.delayMs / degraded 重排（违反"按用户顺序"承诺）。
    return candidates.slice().sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const aNative = a.protocolConversion === 'native' ? 0 : 1;
      const bNative = b.protocolConversion === 'native' ? 0 : 1;
      if (aNative !== bNative) return aNative - bNative;
      return a.id.localeCompare(b.id);
    });
  }
}

interface StickyLike {
  providerAccountId: string;
  realModelName: string;
  endpointUrl?: string | null;
  endpointId?: string | null;
}

/**
 * Sticky 匹配：v1 Slice 3 引入 endpointId 匹配；endpointId 优先于 endpointUrl。
 * 当 sticky 持有 endpointId 且与候选匹配时，忽略 endpointUrl（URL 可能因端点重配置而更新）。
 */
function stickyMatchesSnapshot(sticky: StickyLike, candidate: CandidateSnapshot): boolean {
  if (candidate.providerAccount.id !== sticky.providerAccountId) return false;
  if (candidate.realModelName !== sticky.realModelName) return false;
  // endpointId 优先匹配：当 sticky 持有 endpointId 且匹配时，不必再检查 endpointUrl。
  if (sticky.endpointId) return candidate.endpoint.id === sticky.endpointId;
  // endpointId 不存在时降级到 endpointUrl 字符串匹配（迁移兼容期）。
  if (sticky.endpointUrl && sticky.endpointUrl !== candidate.endpointUrl) return false;
  return true;
}

// 注意：candidate snapshot 的 endpointUrl 由 snapshots.buildEndpointUrl 从
// endpoint.baseUrl / path 现拼，不再需要 routing-decision 关心。
export { buildEndpointUrl };
