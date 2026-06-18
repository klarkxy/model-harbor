import { generateId, type ProviderType, type SourceProtocol } from '@modelharbor/shared';
import { type Db, type TargetType, type UsageRecordInsert, usageRecords } from '../db/index.js';

export interface UsageRecordInput {
  appId: string;
  consumerKeyId: string;
  requestedTargetName: string;
  resolvedTargetType: TargetType;
  resolvedTargetId: string;
  upstreamKeyId: string;
  realModelName: string;
  sourceProtocol: SourceProtocol;
  providerType: ProviderType;
  stream: boolean;
  stickyHit?: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  status: 'success' | 'error';
  errorCode: string | null;
  latencyMs: number;
}

// Persist a single usage record. Called once per gateway request (non-stream)
// and once per stream (success or termination) by the gateway handler. Errors
// here are best-effort: a failure to write must not surface to the client.
export async function writeUsageRecord(db: Db, input: UsageRecordInput): Promise<void> {
  const row: UsageRecordInsert = {
    id: generateId('usageRecord'),
    appId: input.appId,
    consumerKeyId: input.consumerKeyId,
    requestedTargetName: input.requestedTargetName,
    resolvedTargetType: input.resolvedTargetType,
    resolvedTargetId: input.resolvedTargetId,
    upstreamKeyId: input.upstreamKeyId,
    realModelName: input.realModelName,
    sourceProtocol: input.sourceProtocol,
    providerType: input.providerType,
    stream: input.stream,
    stickyHit: input.stickyHit ?? false,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens: input.totalTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheWriteTokens: input.cacheWriteTokens,
    status: input.status,
    errorCode: input.errorCode,
    latencyMs: input.latencyMs,
    createdAt: new Date(),
  };
  try {
    await db.insert(usageRecords).values(row);
  } catch {
    // Usage persistence is observability, not a request correctness concern.
  }
}
