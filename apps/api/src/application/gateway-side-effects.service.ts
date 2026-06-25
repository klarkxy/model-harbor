import { generateId } from '@manageyourllm/shared';
import { randomUUID } from 'node:crypto';
import type { Db } from '../infrastructure/db/client.js';
import { RoutingStateRepository } from '../infrastructure/db/repositories/routing-state.repository.js';
import { UpstreamKeyRepository } from '../infrastructure/db/repositories/upstream-key.repository.js';
import { CostLedgerService } from '../domain/cost-ledger/cost-ledger.service.js';
import {
  dailyConsumptionStats,
  requestTraceLogs,
  usageRecords,
} from '../infrastructure/db/schema.js';
import { eq, and } from 'drizzle-orm';
import type { NormalizedError, ChatUsageIR } from '@manageyourllm/shared';
import type { RoutingCandidate } from '../domain/gateway/routing.types.js';
import type { AdminSettingsRow, QuotaPeriod } from '../infrastructure/db/schema.js';

export interface ExecutionBaseInfo {
  requestTraceId: string;
  appId: string;
  consumerKeyId: string;
  requestedTargetName: string;
  resolvedTargetType: 'public_model' | 'model_group';
  resolvedTargetId: string;
}

export interface TraceEventInfo {
  step: string;
  stepIndex: number;
  upstreamKeyId?: string;
  realModelName?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  details?: Record<string, unknown>;
}

export interface OutcomeInfo extends ExecutionBaseInfo {
  upstreamKeyId: string;
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

function isRetriableFailure(err: NormalizedError | undefined): err is NormalizedError {
  if (!err) return false;
  const retriableCodes = new Set([
    'provider_rate_limit',
    'provider_quota_exhausted',
    'provider_timeout',
    'provider_error',
  ]);
  return retriableCodes.has(err.code);
}

export class GatewaySideEffectsService {
  private readonly routingStateRepo: RoutingStateRepository;
  private readonly upstreamKeyRepo: UpstreamKeyRepository;
  private readonly costLedgerService: CostLedgerService;

  constructor(private readonly db: Db) {
    this.routingStateRepo = new RoutingStateRepository(db);
    this.upstreamKeyRepo = new UpstreamKeyRepository(db);
    this.costLedgerService = new CostLedgerService(db);
  }

  async recordTraceEvent(base: ExecutionBaseInfo, event: TraceEventInfo): Promise<void> {
    const now = new Date();
    await this.db.insert(requestTraceLogs).values({
      id: generateId('trace'),
      requestTraceId: base.requestTraceId,
      step: event.step,
      stepIndex: event.stepIndex,
      appId: base.appId,
      consumerKeyId: base.consumerKeyId,
      requestedTargetName: base.requestedTargetName,
      upstreamKeyId: event.upstreamKeyId ?? null,
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
  ): Promise<void> {
    let index = 0;
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
    candidate: RoutingCandidate,
    info: OutcomeInfo,
    settings: AdminSettingsRow,
    now = new Date(),
  ): Promise<void> {
    const usage = info.usage;
    const status = info.success ? 'success' : (info.error?.code ?? 'provider_error');
    const errorCode = info.success ? null : (info.error?.code ?? null);
    const { costAmount, costCurrency } = await this.costLedgerService.computeCost(
      candidate.providerType,
      candidate.upstreamKey.id,
      candidate.realModelName,
      usage,
      now,
    );
    await this.db.insert(usageRecords).values({
      id: generateId('usageRecord'),
      appId: base.appId,
      consumerKeyId: base.consumerKeyId,
      requestedTargetName: base.requestedTargetName,
      resolvedTargetType: base.resolvedTargetType,
      resolvedTargetId: base.resolvedTargetId,
      requestTraceId: base.requestTraceId,
      upstreamKeyId: candidate.upstreamKey.id,
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

    await this.incrementCounters(candidate.upstreamKey.id, usage, now);
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
      if (settings.enableCircuitBreaker) {
        await this.handleBreakerFailure(candidate, info.error, settings, now);
      }
      await this.setUpstreamCooldown(base, candidate, now);
    }

    await this.upsertEndpointHealth(candidate, info.success, info.latencyMs, info.error, now);
  }

  private async incrementCounters(
    upstreamKeyId: string,
    usage: ChatUsageIR | null,
    now: Date,
  ): Promise<void> {
    const periods: Exclude<QuotaPeriod, 'total'>[] = ['hour', 'day', 'week', 'month'];
    for (const period of periods) {
      const { startedAt, endsAt } = periodBounds(period, now);
      await this.upstreamKeyRepo.incrementCounter(upstreamKeyId, period, startedAt, endsAt, {
        requests: 1,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
      });
    }
  }

  private async upsertDailyStats(
    candidate: RoutingCandidate,
    success: boolean,
    usage: ChatUsageIR | null,
    latencyMs: number,
    costAmount: number,
    costCurrency: string,
    now: Date,
  ): Promise<void> {
    const day = dayDateString(now);
    const existing = await this.db
      .select()
      .from(dailyConsumptionStats)
      .where(
        and(
          eq(dailyConsumptionStats.upstreamKeyId, candidate.upstreamKey.id),
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
        upstreamKeyId: candidate.upstreamKey.id,
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
    candidate: RoutingCandidate,
    info: OutcomeInfo,
    now: Date,
  ): Promise<void> {
    const ttlMs = candidate.upstreamKey.stickySessionTtlMs;
    const expiresAt = new Date(now.getTime() + ttlMs);
    await this.routingStateRepo.upsertStickyBinding({
      appId: base.appId,
      consumerKeyId: base.consumerKeyId,
      requestedTargetName: base.requestedTargetName,
      conversationFingerprint: info.conversationFingerprint,
      upstreamKeyId: candidate.upstreamKey.id,
      realModelName: candidate.realModelName,
      expiresAt,
      lastUsedAt: now,
    });
  }

  private async ensureStickySession(
    base: ExecutionBaseInfo,
    candidate: RoutingCandidate,
    _info: OutcomeInfo,
    now: Date,
  ): Promise<void> {
    const ttlMs = candidate.upstreamKey.stickySessionTtlMs;
    const expiresAt = new Date(now.getTime() + ttlMs);
    await this.routingStateRepo.upsertStickySession({
      consumerKeyId: base.consumerKeyId,
      requestedTargetName: base.requestedTargetName,
      upstreamKeyId: candidate.upstreamKey.id,
      realModelName: candidate.realModelName,
      ttlMs,
      expiresAt,
      lastUsedAt: now,
    });
  }

  private async handleBreakerSuccess(candidate: RoutingCandidate): Promise<void> {
    const existing = await this.routingStateRepo.findBreaker(
      candidate.upstreamKey.id,
      candidate.realModelName,
    );
    if (!existing) return;
    if (existing.state === 'closed') return;
    await this.routingStateRepo.updateBreakerState(
      candidate.upstreamKey.id,
      candidate.realModelName,
      'closed',
      {
        failureCount: 0,
        successCount: existing.successCount + 1,
        cooldownUntil: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    );
  }

  private async handleBreakerFailure(
    candidate: RoutingCandidate,
    error: NormalizedError,
    settings: AdminSettingsRow,
    now: Date,
  ): Promise<void> {
    const existing = await this.routingStateRepo.findBreaker(
      candidate.upstreamKey.id,
      candidate.realModelName,
    );
    const failureCount = (existing?.failureCount ?? 0) + 1;
    const threshold = settings.circuitBreakerFailureThreshold;

    if (failureCount >= threshold) {
      const multiplier = Math.pow(2, Math.max(0, failureCount - threshold));
      const cooldownMs = Math.min(
        settings.circuitBreakerBaseCooldownMs * multiplier,
        settings.circuitBreakerMaxCooldownMs,
      );
      const patch = {
        state: 'open' as const,
        failureCount,
        cooldownUntil: new Date(now.getTime() + cooldownMs),
        openCount: (existing?.openCount ?? 0) + 1,
        openedAt: now,
        lastErrorCode: error.code,
        lastErrorMessage: error.message,
      };
      if (existing) {
        await this.routingStateRepo.updateBreakerState(
          candidate.upstreamKey.id,
          candidate.realModelName,
          'open',
          patch,
        );
      } else {
        await this.routingStateRepo.upsertBreaker({
          upstreamKeyId: candidate.upstreamKey.id,
          realModelName: candidate.realModelName,
          ...patch,
        });
      }
    } else if (existing) {
      await this.routingStateRepo.updateBreakerState(
        candidate.upstreamKey.id,
        candidate.realModelName,
        existing.state,
        {
          failureCount,
          lastErrorCode: error.code,
          lastErrorMessage: error.message,
        },
      );
    } else {
      await this.routingStateRepo.upsertBreaker({
        upstreamKeyId: candidate.upstreamKey.id,
        realModelName: candidate.realModelName,
        state: 'closed',
        failureCount,
        successCount: 0,
        openCount: 0,
        cooldownUntil: null,
        openedAt: null,
        lastErrorCode: error.code,
        lastErrorMessage: error.message,
      });
    }
  }

  private async upsertEndpointHealth(
    candidate: RoutingCandidate,
    success: boolean,
    latencyMs: number,
    error: NormalizedError | undefined,
    now: Date,
  ): Promise<void> {
    await this.routingStateRepo.upsertEndpointHealth({
      upstreamKeyId: candidate.upstreamKey.id,
      endpointBaseUrl: candidate.endpointUrl,
      delayMs: latencyMs,
      lastCheckedAt: now,
      degraded: !success || latencyMs > 5000,
      errorCode: success ? null : (error?.code ?? 'error'),
      errorMessage: success ? null : (error?.message ?? 'unknown error'),
    });
  }

  private async setUpstreamCooldown(
    base: ExecutionBaseInfo,
    candidate: RoutingCandidate,
    now: Date,
  ): Promise<void> {
    const BASE_MS = 30_000;
    const MAX_MS = 300_000;
    const currentRemainingMs =
      candidate.upstreamKey.cooldownUntil && candidate.upstreamKey.cooldownUntil > now
        ? candidate.upstreamKey.cooldownUntil.getTime() - now.getTime()
        : 0;
    const durationMs = Math.min(currentRemainingMs ? currentRemainingMs * 2 : BASE_MS, MAX_MS);
    const cooldownUntil = new Date(now.getTime() + durationMs);

    await this.upstreamKeyRepo.updateCooldown(candidate.upstreamKey.id, cooldownUntil);
    await this.recordTraceEvent(base, {
      step: 'upstream_cooldown_set',
      stepIndex: 900,
      upstreamKeyId: candidate.upstreamKey.id,
      realModelName: candidate.realModelName,
      status: 'ok',
      details: { cooldownUntil: cooldownUntil.toISOString(), durationMs },
    });
  }
}
