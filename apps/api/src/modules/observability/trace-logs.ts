// Request trace logging (M8).
//
// Records every step of a gateway request lifecycle for debugging and
// routing analysis. One trace = multiple rows with the same requestTraceId.
// Automatically pruned after a configurable retention period (default 30 days).

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { generateId } from '@modelharbor/shared';
import {
  type Db,
  type RequestTraceLogInsert,
  type RequestTraceLogRow,
  requestTraceLogs,
} from '../db/index.js';
import type { FilterReason } from '../router/candidates.js';
import type { NormalizedProviderError } from '../providers/types.js';

export type TraceStep =
  | 'request_start'
  | 'auth_success'
  | 'target_resolve'
  | 'access_allowed'
  | 'candidates_expand'
  | 'candidates_filter'
  | 'sticky_check'
  | 'sticky_hit'
  | 'candidate_attempt'
  | 'candidate_success'
  | 'candidate_fail'
  | 'cooldown_applied'
  | 'stream_start'
  | 'stream_end'
  | 'request_complete';

export function generateTraceId(): string {
  return `req_${generateId('trace').slice(-12)}`;
}

export interface TraceLogEntryInput {
  requestTraceId: string;
  step: TraceStep;
  stepIndex: number;
  appId?: string;
  consumerKeyId?: string;
  requestedTargetName?: string;
  resolvedTargetType?: 'public_model' | 'model_group';
  resolvedTargetId?: string;
  sourceProtocol?: string;
  upstreamKeyId?: string;
  upstreamKeyName?: string;
  realModelName?: string;
  endpointProtocol?: string;
  filterReason?: FilterReason;
  acceptedCount?: number;
  droppedCount?: number;
  fallbackCount?: number;
  httpStatus?: number;
  errorCategory?: NormalizedProviderError['category'];
  errorCode?: string;
  errorMessage?: string;
  attemptOrder?: number;
  finalOutcome?: string;
  latencyMs?: number;
  now?: Date;
}

// Write a single trace log entry. Best-effort: never throws.
export async function writeTraceLogEntry(
  db: Db,
  input: TraceLogEntryInput,
): Promise<void> {
  try {
    const row: RequestTraceLogInsert = {
      id: generateId('traceLog'),
      requestTraceId: input.requestTraceId,
      step: input.step,
      stepIndex: input.stepIndex,
      appId: input.appId ?? null,
      consumerKeyId: input.consumerKeyId ?? null,
      requestedTargetName: input.requestedTargetName ?? null,
      resolvedTargetType: input.resolvedTargetType ?? null,
      resolvedTargetId: input.resolvedTargetId ?? null,
      sourceProtocol: input.sourceProtocol ?? null,
      upstreamKeyId: input.upstreamKeyId ?? null,
      upstreamKeyName: input.upstreamKeyName ?? null,
      realModelName: input.realModelName ?? null,
      endpointProtocol: input.endpointProtocol ?? null,
      filterReason: input.filterReason ?? null,
      acceptedCount: input.acceptedCount ?? null,
      droppedCount: input.droppedCount ?? null,
      fallbackCount: input.fallbackCount ?? null,
      httpStatus: input.httpStatus ?? null,
      errorCategory: input.errorCategory ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      attemptOrder: input.attemptOrder ?? null,
      finalOutcome: input.finalOutcome ?? null,
      latencyMs: input.latencyMs ?? null,
      createdAt: input.now ?? new Date(),
    };
    await db.insert(requestTraceLogs).values(row);
  } catch {
    /* best-effort: trace logging must never break the request */
  }
}

export interface TraceTimeline {
  requestTraceId: string;
  steps: RequestTraceLogRow[];
}

// Read a full trace timeline by trace id.
export async function getTraceTimeline(
  db: Db,
  requestTraceId: string,
): Promise<TraceTimeline | null> {
  const rows = await db
    .select()
    .from(requestTraceLogs)
    .where(eq(requestTraceLogs.requestTraceId, requestTraceId))
    .orderBy(requestTraceLogs.stepIndex)
    .all();
  if (rows.length === 0) return null;
  return { requestTraceId, steps: rows };
}

// List recent traces with their first step (request_start) for the dashboard.
export interface TraceSummary {
  requestTraceId: string;
  requestedTargetName: string | null;
  consumerKeyId: string | null;
  appId: string | null;
  sourceProtocol: string | null;
  createdAt: Date;
  finalOutcome: string | null;
}

export async function listRecentTraces(
  db: Db,
  args: { limit: number; since?: Date },
): Promise<TraceSummary[]> {
  // SQLite window function: one row per trace, pick the first step by stepIndex
  const rows = await db
    .select()
    .from(requestTraceLogs)
    .where(
      and(
        eq(requestTraceLogs.step, 'request_start'),
        args.since ? gte(requestTraceLogs.createdAt, args.since) : undefined,
      ),
    )
    .orderBy(sql`${requestTraceLogs.createdAt} DESC`)
    .limit(args.limit)
    .all();
  return rows.map((r) => ({
    requestTraceId: r.requestTraceId,
    requestedTargetName: r.requestedTargetName,
    consumerKeyId: r.consumerKeyId,
    appId: r.appId,
    sourceProtocol: r.sourceProtocol,
    createdAt: r.createdAt,
    finalOutcome: r.finalOutcome,
  }));
}

// Delete trace logs older than the retention period. Called by the jobs runner.
// Default retention: 30 days.
export async function pruneTraceLogs(
  db: Db,
  args: { now: Date; retentionDays?: number },
): Promise<number> {
  const retentionMs = (args.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
  const cutoff = new Date(args.now.getTime() - retentionMs);
  const rows = await db
    .select()
    .from(requestTraceLogs)
    .where(lte(requestTraceLogs.createdAt, cutoff))
    .all();
  let removed = 0;
  for (const r of rows) {
    try {
      await db.delete(requestTraceLogs).where(eq(requestTraceLogs.id, r.id));
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  return removed;
}
