import { generateId } from '@manageyourllm/shared';
import { randomUUID } from 'node:crypto';
import type { Db } from '../infrastructure/db/client.js';
import { RoutingStateRepository } from '../infrastructure/db/repositories/routing-state.repository.js';
import { ProviderAccountRepository } from '../infrastructure/db/repositories/provider-account.repository.js';
import { EndpointHealthRepository } from '../infrastructure/db/repositories/endpoint-health.repository.js';
import { CostLedgerService } from './cost-ledger.service.js';
import { SettingsService } from './settings.service.js';
import { redactAndTruncate } from '../domain/observability/content-log-redaction.js';
import { ObservabilityRepository } from '../infrastructure/db/repositories/observability.repository.js';
import {
  dailyConsumptionStats,
  debugContentLogs,
  requestTraceLogs,
  usageRecords,
} from '../infrastructure/db/schema.js';
import { eq, and, count, asc, inArray } from 'drizzle-orm';
import type { NormalizedError, ChatUsageIR } from '@manageyourllm/shared';
import type { CandidateSnapshot } from './routing.types.js';
import type { AdminSettingsRow, QuotaPeriod } from '../infrastructure/db/schema.js';

export interface ExecutionBaseInfo {
  requestTraceId: string;
  clientId: string;
  clientKeyId: string;
  requestedTargetName: string;
  resolvedTargetType: 'model' | 'channel';
  resolvedTargetId: string;
}

export interface TraceEventInfo {
  step: string;
  stepIndex: number;
  providerAccountId?: string;
  endpointId?: string;
  realModelName?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  details?: Record<string, unknown>;
}

export interface OutcomeInfo extends ExecutionBaseInfo {
  providerAccountId: string;
  realModelName: string;
  sourceProtocol: string;
  providerType: string;
  stream: boolean;
  stickyHit: boolean;
  sessionStickyHit: boolean;
  conversationFingerprint: string;
  latencyMs: number;
  success: boolean;
  usage: ChatUsageIR | null;
  error?: NormalizedError;
}

function dayDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function periodBounds(
  period: Exclude<QuotaPeriod, 'total'>,
  now: Date,
): { startedAt: Date; endsAt: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  const hours = now.getUTCHours();

  switch (period) {
    case 'hour': {
      const startedAt = new Date(Date.UTC(year, month, date, hours, 0, 0, 0));
      return { startedAt, endsAt: new Date(startedAt.getTime() + 60 * 60 * 1000) };
    }
    case 'day': {
      const startedAt = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
      return { startedAt, endsAt: new Date(startedAt.getTime() + 24 * 60 * 60 * 1000) };
    }
    case 'week': {
      const day = now.getUTCDay();
      const diff = day === 0 ? 6 : day - 1;
      const startedAt = new Date(Date.UTC(year, month, date - diff, 0, 0, 0, 0));
      return { startedAt, endsAt: new Date(startedAt.getTime() + 7 * 24 * 60 * 60 * 1000) };
    }
    case 'month': {
      const startedAt = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      return { startedAt, endsAt: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)) };
    }
  }
}

/**
 * 决定一次上游失败是否应该计入 per-candidate cooldown 与 circuit breaker。
 *
 * v1 Phase 5：白名单形式，只有真正的"上游瞬时/容量问题"才计入——
 * - 429（rate_limit）
 * - 408 / abort（timeout）
 * - quota（上游返回 insufficient_quota）
 * - overloaded（529 或 code 字段含 overloaded / capacity）
 * - 5xx（server-side 上游故障，details.status >= 500；落 provider_error 类）
 *
 * bad_request（400/422）、auth（401/403）、model_not_found（404 + model）**不计入**，
 * 这些是请求侧或配置侧问题，不应该让上游 candidate 因此被熔断。
 * LiteLLM 借鉴：context_window_exceeded / content_policy 同样不计入 cooldown / breaker。
 */
function isRetriableFailure(err: NormalizedError | undefined): err is NormalizedError {
  if (!err) return false;
  if (err.code === 'provider_rate_limit') return true;
  if (err.code === 'provider_quota_exhausted') return true;
  if (err.code === 'provider_timeout') return true;
  if (err.code === 'provider_overloaded') return true;
  if (err.code === 'provider_error') {
    // provider_error 覆盖两类：
    // 1. 上游返回 5xx（HTTP 状态码已知）
    // 2. 网络/transport 错误（无 HTTP 状态码 → details.status 缺失），
    //    由 `toNormalizedError` 把原生 Error（DNS / ECONNREFUSED / TLS）包成裸 ProviderError。
    // 没有 status 时视为可重试（network-level transient），避免上游不可达时不进 cooldown。
    const status = err.details?.['status'] as number | undefined;
    if (status === undefined) return true;
    return status >= 500;
  }
  return false;
}

export class GatewaySideEffectsService {
  private readonly routingStateRepo: RoutingStateRepository;
  private readonly providerAccountRepo: ProviderAccountRepository;
  private readonly endpointHealthRepo: EndpointHealthRepository;
  private readonly costLedgerService: CostLedgerService;

  constructor(private readonly db: Db) {
    this.routingStateRepo = new RoutingStateRepository(db);
    this.providerAccountRepo = new ProviderAccountRepository(db);
    this.endpointHealthRepo = new EndpointHealthRepository(db);
    this.costLedgerService = new CostLedgerService(db);
  }

  async recordDebugContent(
    base: ExecutionBaseInfo,
    settings: AdminSettingsRow,
    prompt: unknown,
    response: unknown,
    usage: ChatUsageIR | null,
  ): Promise<void> {
    if (!settings.contentLogEnabled) return;
    const now = new Date();
    if (settings.contentLogExpiresAt && settings.contentLogExpiresAt <= now) return;

    const maxPayloadBytes = settings.contentLogMaxPayloadBytes;
    const maxRows = settings.contentLogMaxRows;

    const safePrompt = redactAndTruncate(prompt, maxPayloadBytes);
    const safeResponse = redactAndTruncate(response, maxPayloadBytes);

    if (maxRows > 0) {
      const [current] = await this.db.select({ total: count() }).from(debugContentLogs);
      const total = current?.total ?? 0;
      if (total >= maxRows) {
        const excess = total - maxRows + 1;
        const oldest = await this.db
          .select({ id: debugContentLogs.id })
          .from(debugContentLogs)
          .orderBy(asc(debugContentLogs.createdAt))
          .limit(excess);
        if (oldest.length > 0) {
          await this.db.delete(debugContentLogs).where(
            inArray(
              debugContentLogs.id,
              oldest.map((r) => r.id),
            ),
          );
        }
      }
    }

    const repo = new ObservabilityRepository(this.db);
    await repo.insertDebugContentLog({
      requestTraceId: base.requestTraceId,
      promptJson: safePrompt,
      responseJson: safeResponse,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
    });
  }

  async recordTraceEvent(base: ExecutionBaseInfo, event: TraceEventInfo): Promise<void> {
    const now = new Date();
    await this.db.insert(requestTraceLogs).values({
      id: generateId('trace'),
      requestTraceId: base.requestTraceId,
      step: event.step,
      stepIndex: event.stepIndex,
      clientId: base.clientId,
      clientKeyId: base.clientKeyId,
      requestedTargetName: base.requestedTargetName,
      providerAccountId: event.providerAccountId ?? null,
      // 收口 #12：endpointId 也写入 trace event，便于 trace 链路按 endpoint 过滤。
      endpointId: event.endpointId ?? null,
      realModelName: event.realModelName ?? null,
      status: event.status ?? null,
      errorCode: event.errorCode ?? null,
      errorMessage: event.errorMessage ?? null,
      detailsJson: event.details ?? null,
      createdAt: now,
    });
  }

  async recordDecisionTraceEvents(
    base: ExecutionBaseInfo,
    traceEvents: Array<{ step: string; status: string; details?: Record<string, unknown> }>,
    startIndex = 0,
  ): Promise<void> {
    let index = startIndex;
    for (const event of traceEvents) {
      await this.recordTraceEvent(base, {
        step: event.step,
        stepIndex: index++,
        status: event.status,
        details: event.details,
      });
    }
  }

  async recordOutcome(
    base: ExecutionBaseInfo,
    candidate: CandidateSnapshot,
    info: OutcomeInfo,
    settings: AdminSettingsRow,
    now = new Date(),
  ): Promise<void> {
    const usage = info.usage;
    const status = info.success ? 'success' : (info.error?.code ?? 'provider_error');
    const errorCode = info.success ? null : (info.error?.code ?? null);
    const { costAmount, costCurrency } = await this.costLedgerService.computeCost(
      candidate.providerType,
      candidate.providerAccount.id,
      candidate.realModelName,
      usage,
      now,
    );
    await this.db.insert(usageRecords).values({
      id: generateId('usageRecord'),
      clientId: base.clientId,
      clientKeyId: base.clientKeyId,
      requestedTargetName: base.requestedTargetName,
      resolvedTargetType: base.resolvedTargetType,
      resolvedTargetId: base.resolvedTargetId,
      requestTraceId: base.requestTraceId,
      providerAccountId: candidate.providerAccount.id,
      endpointId: candidate.endpoint.id,
      realModelName: candidate.realModelName,
      sourceProtocol: info.sourceProtocol,
      providerType: candidate.providerType,
      stream: info.stream,
      stickyHit: info.stickyHit,
      sessionStickyHit: info.sessionStickyHit,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      cacheReadTokens: usage?.cacheReadTokens ?? null,
      cacheWriteTokens: usage?.cacheWriteTokens ?? null,
      status,
      errorCode,
      latencyMs: info.latencyMs,
      costAmount,
      costCurrency,
      createdAt: now,
    });

    await this.incrementCounters(candidate.providerAccount.id, usage, now);
    await this.upsertDailyStats(
      candidate,
      info.success,
      usage,
      info.latencyMs,
      costAmount,
      costCurrency,
      now,
    );

    if (info.success) {
      await this.ensureStickyBinding(base, candidate, info, now);
      await this.ensureStickySession(base, candidate, info, now);
      await this.handleBreakerSuccess(candidate);
    } else if (isRetriableFailure(info.error)) {
      // 收口 #2：每个 retriable 失败立即叠加 per-candidate 指数退避，与熔断器阈值独立。
      // 即便熔断器关闭或未达阈值，broken upstream 也会在 (base, base*2, base*4, ...) 上冷却，
      // 防止前 (threshold-1) 次失败毫无间隔地重击 upstream。
      await this.setCandidateCooldown(base, candidate, settings, now);
      if (settings.enableCircuitBreaker) {
        await this.handleBreakerFailure(candidate, info.error, settings, now);
      }
    }

    await this.upsertEndpointHealth(candidate, info.success, info.latencyMs, info.error, now);
  }

  private async incrementCounters(
    providerAccountId: string,
    usage: ChatUsageIR | null,
    now: Date,
  ): Promise<void> {
    const periods: Exclude<QuotaPeriod, 'total'>[] = ['hour', 'day', 'week', 'month'];
    await Promise.all(
      periods.map((period) => {
        const { startedAt, endsAt } = periodBounds(period, now);
        return this.providerAccountRepo.incrementCounter(
          providerAccountId,
          period,
          startedAt,
          endsAt,
          {
            requests: 1,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            totalTokens: usage?.totalTokens ?? 0,
          },
        );
      }),
    );
  }

  private async upsertDailyStats(
    candidate: CandidateSnapshot,
    success: boolean,
    usage: ChatUsageIR | null,
    latencyMs: number,
    costAmount: number,
    costCurrency: string,
    now: Date,
  ): Promise<void> {
    const day = dayDateString(now);
    // 收口 #4：daily_consumption_stats UNIQUE 包含 endpoint_id 后，SELECT 也要按 endpoint 过滤，
    // 否则同 provider/realModel/day 下多 endpoint 的行会找不到现有行 → INSERT → UNIQUE 冲突。
    const existing = await this.db
      .select()
      .from(dailyConsumptionStats)
      .where(
        and(
          eq(dailyConsumptionStats.providerAccountId, candidate.providerAccount.id),
          eq(dailyConsumptionStats.endpointId, candidate.endpoint.id),
          eq(dailyConsumptionStats.realModelName, candidate.realModelName),
          eq(dailyConsumptionStats.dayDate, day),
        ),
      )
      .limit(1);

    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const totalTokens = usage?.totalTokens ?? 0;
    const cacheReadTokens = usage?.cacheReadTokens ?? 0;
    const cacheWriteTokens = usage?.cacheWriteTokens ?? 0;

    if (existing[0]) {
      const row = existing[0];
      const totalLatency = row.avgLatencyMs * row.requestCount + latencyMs;
      const newCount = row.requestCount + 1;
      await this.db
        .update(dailyConsumptionStats)
        .set({
          requestCount: newCount,
          successCount: row.successCount + (success ? 1 : 0),
          errorCount: row.errorCount + (success ? 0 : 1),
          inputTokens: row.inputTokens + inputTokens,
          outputTokens: row.outputTokens + outputTokens,
          totalTokens: row.totalTokens + totalTokens,
          cacheReadTokens: row.cacheReadTokens + cacheReadTokens,
          cacheWriteTokens: row.cacheWriteTokens + cacheWriteTokens,
          avgLatencyMs: Math.round(totalLatency / newCount),
          totalCostAmount: row.totalCostAmount + costAmount,
          costCurrency,
          updatedAt: now,
        })
        .where(eq(dailyConsumptionStats.id, row.id));
    } else {
      await this.db.insert(dailyConsumptionStats).values({
        id: `ds_${randomUUID().replace(/-/g, '')}`,
        providerAccountId: candidate.providerAccount.id,
        endpointId: candidate.endpoint.id,
        realModelName: candidate.realModelName,
        dayDate: day,
        requestCount: 1,
        successCount: success ? 1 : 0,
        errorCount: success ? 0 : 1,
        inputTokens,
        outputTokens,
        totalTokens,
        cacheReadTokens,
        cacheWriteTokens,
        avgLatencyMs: latencyMs,
        totalCostAmount: costAmount,
        costCurrency,
        updatedAt: now,
      });
    }
  }

  private async ensureStickyBinding(
    base: ExecutionBaseInfo,
    candidate: CandidateSnapshot,
    info: OutcomeInfo,
    now: Date,
  ): Promise<void> {
    const ttlMs = candidate.providerAccount.stickySessionTtlMs;
    const expiresAt = new Date(now.getTime() + ttlMs);
    // 收口 #10：把 candidate.endpoint.id 一并写入 sticky_binding，让后续请求
    // 按 endpointId 严格匹配，防止 endpoint 重配置后仍命中旧 endpoint。
    await this.routingStateRepo.upsertStickyBinding({
      clientId: base.clientId,
      clientKeyId: base.clientKeyId,
      requestedTargetName: base.requestedTargetName,
      conversationFingerprint: info.conversationFingerprint,
      providerAccountId: candidate.providerAccount.id,
      endpointId: candidate.endpoint.id,
      endpointUrl: candidate.endpointUrl,
      realModelName: candidate.realModelName,
      expiresAt,
      lastUsedAt: now,
    });
  }

  private async ensureStickySession(
    base: ExecutionBaseInfo,
    candidate: CandidateSnapshot,
    _info: OutcomeInfo,
    now: Date,
  ): Promise<void> {
    const ttlMs = candidate.providerAccount.stickySessionTtlMs;
    const expiresAt = new Date(now.getTime() + ttlMs);
    await this.routingStateRepo.upsertStickySession({
      clientKeyId: base.clientKeyId,
      requestedTargetName: base.requestedTargetName,
      providerAccountId: candidate.providerAccount.id,
      endpointId: candidate.endpoint.id,
      endpointUrl: candidate.endpointUrl,
      realModelName: candidate.realModelName,
      ttlMs,
      expiresAt,
      lastUsedAt: now,
    });
  }

  private async handleBreakerSuccess(candidate: CandidateSnapshot): Promise<void> {
    // 收口 #5：用原子 UPDATE（incrementBreakerSuccessAtomic）替代 read-then-write。
    // 只有 state=half_open 时才累加 successCount 并清零 failureCount；其他状态由
    // closeBreaker 原子关闭熔断器。
    const updated = await this.routingStateRepo.incrementBreakerSuccessAtomic(
      candidate.providerAccount.id,
      candidate.endpoint.id,
      candidate.realModelName,
      new Date(),
    );
    if (!updated) return;
    if (updated.state !== 'half_open') return;

    const threshold = await this.halfOpenSuccessThreshold();
    if (updated.successCount >= threshold) {
      await this.routingStateRepo.closeBreaker(
        candidate.providerAccount.id,
        candidate.endpoint.id,
        candidate.realModelName,
        new Date(),
      );
    }
  }

  private async halfOpenSuccessThreshold(): Promise<number> {
    const settings = await new SettingsService(this.db).getSettings();
    return settings.circuitBreakerHalfOpenSuccessCount ?? 2;
  }

  private async handleBreakerFailure(
    candidate: CandidateSnapshot,
    error: NormalizedError,
    settings: AdminSettingsRow,
    now: Date,
  ): Promise<void> {
    // 收口 #5：原子累加失败计数（仅 closed/half_open 状态），避免 lost-update。
    // half_open 失败 → 直接 open（不再二次回 half_open）。
    // closed 失败 → 累加计数；若达到 threshold 则原子过渡到 open。
    // open 状态失败 → setCandidateCooldown 已处理，熔断器计数不再叠加。
    const existing = await this.routingStateRepo.findBreaker(
      candidate.providerAccount.id,
      candidate.endpoint.id,
      candidate.realModelName,
    );

    if (existing?.state === 'half_open') {
      // half_open 失败 → 基于 breaker 当前累计失败次数的指数退避，与 closed→open 路径保持一致的乘数计算。
      const threshold = settings.circuitBreakerFailureThreshold;
      const effectiveFailures = (existing.failureCount ?? 0) + 1;
      const multiplier = Math.pow(2, Math.max(0, effectiveFailures - (threshold ?? 5)));
      const cooldownMs = Math.min(
        settings.circuitBreakerBaseCooldownMs * multiplier,
        settings.circuitBreakerMaxCooldownMs,
      );
      await this.routingStateRepo.transitionBreakerState(
        candidate.providerAccount.id,
        candidate.endpoint.id,
        candidate.realModelName,
        'half_open',
        'open',
        {
          failureCount: (existing.failureCount ?? 0) + 1,
          successCount: 0,
          cooldownUntil: new Date(now.getTime() + cooldownMs),
          openCount: (existing.openCount ?? 0) + 1,
          openedAt: now,
          lastErrorCode: error.code,
          lastErrorMessage: error.message,
        },
        now,
      );
      return;
    }

    if (existing?.state === 'open') {
      // 已是 open：per-candidate cooldown 由 setCandidateCooldown 写入/延长，
      // 熔断器计数不动，避免 openCount 漂移。
      return;
    }

    // closed 状态：原子累加失败计数（不写入 cooldownUntil，cooldown 由
    // setCandidateCooldown 独立管理）。
    const updated = await this.routingStateRepo.incrementBreakerFailureAtomic(
      candidate.providerAccount.id,
      candidate.endpoint.id,
      candidate.realModelName,
      { code: error.code, message: error.message },
      now,
    );

    if (!updated) {
      // 没有 closed/half_open 行可更新：说明 breaker 已被并发请求置为 open，
      // 或者第一次失败就超过阈值（不可能，因为 closed 起始计数为 0）。忽略。
      return;
    }

    const threshold = settings.circuitBreakerFailureThreshold;
    if (updated.failureCount < threshold) {
      return; // 未达阈值，仅计数增加
    }

    // 达到阈值：原子过渡到 open。乘数基于超出的失败次数（与旧实现一致）。
    const multiplier = Math.pow(2, Math.max(0, updated.failureCount - threshold));
    const cooldownMs = Math.min(
      settings.circuitBreakerBaseCooldownMs * multiplier,
      settings.circuitBreakerMaxCooldownMs,
    );
    await this.routingStateRepo.transitionBreakerState(
      candidate.providerAccount.id,
      candidate.endpoint.id,
      candidate.realModelName,
      'closed',
      'open',
      {
        state: 'open',
        failureCount: updated.failureCount,
        cooldownUntil: new Date(now.getTime() + cooldownMs),
        openCount: (updated.openCount ?? 0) + 1,
        openedAt: now,
        lastErrorCode: error.code,
        lastErrorMessage: error.message,
      },
      now,
    );
  }

  /**
   * 收口 #2：每个 retriable 失败都叠加 per-candidate 指数退避。
   * 实现：在 circuit_breakers 同一行上记录 candidate 级 cooldownUntil，与熔断器独立。
   * 路由层（filter_breaker_open / filter_cooldown）已会读该字段把处于 cooldown 的 candidate 过滤掉。
   * 这里要避免与熔断器本身的 cooldownUntil 冲突：写之前先读，若 breaker 已 open 且其
   * cooldownUntil 仍在未来，则不缩短；若没有 or 已过期则取 max(当前剩余 * 2, base)。
   */
  private async setCandidateCooldown(
    base: ExecutionBaseInfo,
    candidate: CandidateSnapshot,
    settings: AdminSettingsRow,
    now: Date,
  ): Promise<void> {
    const baseMs = settings.circuitBreakerBaseCooldownMs;
    const maxMs = settings.circuitBreakerMaxCooldownMs;
    const existing = await this.routingStateRepo.findBreaker(
      candidate.providerAccount.id,
      candidate.endpoint.id,
      candidate.realModelName,
    );
    let nextDurationMs: number;
    if (existing?.cooldownUntil && existing.cooldownUntil > now) {
      // 仍在冷却中：指数退避（翻倍），封顶 maxMs。
      const remaining = existing.cooldownUntil.getTime() - now.getTime();
      nextDurationMs = Math.min(remaining * 2, maxMs);
    } else {
      // 全新失败 / 已过冷却：基数。
      nextDurationMs = baseMs;
    }
    const cooldownUntil = new Date(now.getTime() + nextDurationMs);

    if (existing) {
      // 只更新 cooldownUntil + updatedAt + lastError，不动 state/failureCount/openCount。
      await this.routingStateRepo.updateBreakerCooldown(
        candidate.providerAccount.id,
        candidate.endpoint.id,
        candidate.realModelName,
        {
          cooldownUntil,
          lastErrorCode: 'retriable_failure',
          lastErrorMessage: 'cooldown extended',
        },
      );
    } else {
      // 还没有 breaker 行：起一个 closed 行专门用于记录冷却。
      await this.routingStateRepo.upsertBreaker({
        providerAccountId: candidate.providerAccount.id,
        endpointId: candidate.endpoint.id,
        realModelName: candidate.realModelName,
        state: 'closed',
        failureCount: 1,
        successCount: 0,
        openCount: 0,
        cooldownUntil,
        openedAt: null,
        lastErrorCode: 'retriable_failure',
        lastErrorMessage: 'cooldown set on first failure',
      });
    }

    await this.recordTraceEvent(base, {
      step: 'candidate_cooldown_set',
      stepIndex: 900,
      endpointId: candidate.endpoint.id,
      providerAccountId: candidate.providerAccount.id,
      realModelName: candidate.realModelName,
      status: 'ok',
      details: { cooldownUntil: cooldownUntil.toISOString(), durationMs: nextDurationMs },
    });
  }

  private async upsertEndpointHealth(
    candidate: CandidateSnapshot,
    success: boolean,
    latencyMs: number,
    error: NormalizedError | undefined,
    now: Date,
  ): Promise<void> {
    // 收口 #7：candidate.endpoint.id 直接可用，不再做 baseUrl+path 字符串匹配。
    // 之前字符串匹配会因 trailing-slash / path 规范化差异漏匹配，导致
    // endpoint_health 表停止更新。这里直接用 snapshot 上的 id。
    await this.endpointHealthRepo.upsert({
      endpointId: candidate.endpoint.id,
      delayMs: latencyMs,
      lastCheckedAt: now,
      degraded: !success || latencyMs > 5000,
      errorCode: success ? null : (error?.code ?? 'error'),
      errorMessage: success ? null : (error?.message ?? 'unknown error'),
    });
  }
}
