import { ObservabilityRepository } from '../infrastructure/db/repositories/observability.repository.js';
import type { Db } from '../infrastructure/db/client.js';

export interface TraceSummary {
  requestTraceId: string;
  appId: string;
  consumerKeyId: string;
  requestedTargetName: string;
  upstreamKeyId: string;
  realModelName: string;
  resolvedTargetType: 'public_model' | 'model_group' | null;
  resolvedTargetId: string | null;
  status: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  attemptCount: number;
  createdAt: string;
}

export interface TraceEventItem {
  id: string;
  step: string;
  stepIndex: number;
  status: string | null;
  upstreamKeyId: string | null;
  realModelName: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface TraceDetail {
  summary: TraceSummary | null;
  events: TraceEventItem[];
}

export class TraceService {
  private readonly repo: ObservabilityRepository;

  constructor(private readonly db: Db) {
    this.repo = new ObservabilityRepository(db);
  }

  async listTraces(since: Date, limit = 50): Promise<TraceSummary[]> {
    const rows = await this.repo.listTraces(since, limit);
    return rows.map((r) => ({
      requestTraceId: r.requestTraceId,
      appId: r.appId,
      consumerKeyId: r.consumerKeyId,
      requestedTargetName: r.requestedTargetName,
      upstreamKeyId: r.upstreamKeyId,
      realModelName: r.realModelName,
      resolvedTargetType: r.resolvedTargetType,
      resolvedTargetId: r.resolvedTargetId,
      status: r.status,
      latencyMs: r.latencyMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      attemptCount: r.failedCount + 1,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getTraceDetail(requestTraceId: string): Promise<TraceDetail> {
    const usageRecord = await this.repo.findTraceUsageRecord(requestTraceId);
    const rawEvents = await this.repo.listTraceLogsByRequestTraceId(requestTraceId);
    const events: TraceEventItem[] = rawEvents.map((e) => ({
      id: e.id,
      step: e.step,
      stepIndex: e.stepIndex,
      status: e.status ?? null,
      upstreamKeyId: e.upstreamKeyId ?? null,
      realModelName: e.realModelName ?? null,
      errorCode: e.errorCode ?? null,
      errorMessage: e.errorMessage ?? null,
      details: e.detailsJson ?? null,
      createdAt: e.createdAt.toISOString(),
    }));

    if (!usageRecord) {
      return { summary: null, events };
    }

    const failedCount = rawEvents.filter((e) => e.step === 'upstream_attempt_failed').length;

    const summary: TraceSummary = {
      requestTraceId: usageRecord.requestTraceId ?? requestTraceId,
      appId: usageRecord.appId,
      consumerKeyId: usageRecord.consumerKeyId,
      requestedTargetName: usageRecord.requestedTargetName,
      upstreamKeyId: usageRecord.upstreamKeyId,
      realModelName: usageRecord.realModelName,
      resolvedTargetType: usageRecord.resolvedTargetType,
      resolvedTargetId: usageRecord.resolvedTargetId,
      status: usageRecord.status,
      latencyMs: usageRecord.latencyMs,
      inputTokens: usageRecord.inputTokens,
      outputTokens: usageRecord.outputTokens,
      totalTokens: usageRecord.totalTokens,
      attemptCount: failedCount + 1,
      createdAt: usageRecord.createdAt.toISOString(),
    };

    return { summary, events };
  }
}
