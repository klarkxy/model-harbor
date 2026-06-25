import { ObservabilityRepository } from '../infrastructure/db/repositories/observability.repository.js';
import type { Db } from '../infrastructure/db/client.js';
import type { RequestTraceLogRow, UsageRecordRow } from '../infrastructure/db/schema.js';

export interface TraceSummary {
  requestTraceId: string;
  appId: string;
  consumerKeyId: string;
  requestedTargetName: string;
  upstreamKeyId: string;
  realModelName: string;
  status: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  attemptCount: number;
  createdAt: Date;
}

export interface TraceDetail {
  summary: TraceSummary | null;
  events: RequestTraceLogRow[];
}

export class TraceService {
  constructor(private readonly db: Db) {}

  async listTraces(since = new Date(Date.now() - 24 * 60 * 60 * 1000), limit = 100): Promise<TraceSummary[]> {
    const repo = new ObservabilityRepository(this.db);
    const rows = await repo.listTraces(since, limit);
    return rows.map((row) => ({
      requestTraceId: row.requestTraceId,
      appId: row.appId,
      consumerKeyId: row.consumerKeyId,
      requestedTargetName: row.requestedTargetName,
      upstreamKeyId: row.upstreamKeyId,
      realModelName: row.realModelName,
      status: row.status,
      latencyMs: row.latencyMs,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      attemptCount: row.failedCount + (row.status === 'success' ? 1 : 0),
      createdAt: row.createdAt,
    }));
  }

  async getTraceDetail(requestTraceId: string): Promise<TraceDetail> {
    const repo = new ObservabilityRepository(this.db);
    const [summary, events] = await Promise.all([
      repo.findTraceUsageRecord(requestTraceId),
      repo.listTraceLogsByRequestTraceId(requestTraceId),
    ]);
    if (!summary) {
      return { summary: null, events };
    }
    const failedCount = events.filter((e) => e.step === 'upstream_attempt_failed').length;
    return {
      summary: {
        requestTraceId: summary.requestTraceId ?? requestTraceId,
        appId: summary.appId,
        consumerKeyId: summary.consumerKeyId,
        requestedTargetName: summary.requestedTargetName,
        upstreamKeyId: summary.upstreamKeyId,
        realModelName: summary.realModelName,
        status: summary.status,
        latencyMs: summary.latencyMs,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        totalTokens: summary.totalTokens,
        attemptCount: failedCount + (summary.status === 'success' ? 1 : 0),
        createdAt: summary.createdAt,
      },
      events,
    };
  }
}
