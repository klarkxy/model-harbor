import {
  type ChatRequestIR,
  type SourceProtocol,
  NoRouteAvailableError,
  TargetNotFoundError,
  ValidationError,
} from '@modelharbor/shared';
import {
  type ProviderAdapter,
  type ProviderHttpRequest,
  type ProviderRequestContext,
  anthropicRequestToIR,
  openaiRequestToIR,
  codexRequestToIR,
  getProviderAdapter,
} from '../providers/index.js';
import { type NormalizedProviderError } from '../providers/types.js';
import { type Db } from '../db/index.js';
import { resolveAuthorizationHeader } from '../providers/auth/index.js';
import { assertConsumerKeyAccess } from '../router/access.js';
import {
  expandCandidates,
  filterCandidates,
  type ResolvedCandidate,
} from '../router/candidates.js';
import { resolveTargetByName, type ResolvedTarget } from '../router/resolve.js';
import { applyCooldown, computeCooldownUpdate, shouldCooldown } from './cooldown.js';
import {
  conversationFingerprint,
  isStickyBindingValid,
  lookupStickyBinding,
  touchStickyBinding,
  upsertStickyBinding,
} from '../sticky/index.js';
import { getEnabledQuotaPeriods, recordQuotaUsage, wouldExceedQuota } from '../quota/index.js';
import { startUpstreamStream, type RawStreamEvent, type StreamStart } from './stream-sender.js';
import { writeUsageRecord } from '../usage/index.js';
import {
  generateTraceId,
  writeTraceLogEntry,
  upsertConsumptionStats,
} from '../observability/index.js';
import {
  ProviderError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderStreamError,
  ProviderTimeoutError,
} from '@modelharbor/shared';
import type { FastifyReply } from 'fastify';

export interface StreamGatewayContext {
  db: Db;
  secretKey: string;
  consumerKeyId: string;
  appId: string;
  defaultUpstreamTimeoutMs?: number;
  traceId?: string;
}

export interface StreamRequestContext {
  ir: ChatRequestIR;
  sourceProtocol: SourceProtocol;
}

const FAILOVER_CATEGORIES: ReadonlySet<string> = new Set([
  'provider_rate_limit',
  'provider_quota',
  'provider_overloaded',
  'provider_timeout',
]);

interface NormalizedErrorLite {
  category: NormalizedProviderError['category'];
  providerCode: string | null;
  providerMessage: string | null;
  upstreamStatus: number;
}

const CLIENT_DISCONNECTED: NormalizedErrorLite = {
  category: 'provider_stream_error',
  providerCode: 'client_disconnected',
  providerMessage: 'client disconnected mid-stream',
  upstreamStatus: 200,
};

// Drive the streaming path: resolve target, expand candidates, pick one,
// open the upstream stream, write each frame to the client, and write a
// usage record on completion (success or failure). Failover is supported
// only when no frames have been written to the client yet.
export async function handleStreamRequest(
  ctx: StreamGatewayContext,
  streamCtx: StreamRequestContext,
  reply: FastifyReply,
): Promise<void> {
  const start = Date.now();
  const traceId = ctx.traceId ?? generateTraceId();
  let stepIndex = 0;
  const log = (input: Omit<import('../observability/trace-logs.js').TraceLogEntryInput, 'requestTraceId' | 'stepIndex'> & { step: import('../observability/trace-logs.js').TraceStep }) =>
    writeTraceLogEntry(ctx.db, { ...input, requestTraceId: traceId, stepIndex: ++stepIndex, now: new Date() });

  await log({ step: 'request_start', appId: ctx.appId, consumerKeyId: ctx.consumerKeyId, requestedTargetName: streamCtx.ir.requestedModel, sourceProtocol: streamCtx.sourceProtocol });

  const target = await resolveTargetByName(ctx.db, streamCtx.ir.requestedModel);
  await log({ step: 'target_resolve', resolvedTargetType: target.targetType, resolvedTargetId: target.targetId });

  await assertConsumerKeyAccess(ctx.db, {
    consumerKeyId: ctx.consumerKeyId,
    targetType: target.targetType,
    targetId: target.targetId,
  });
  await log({ step: 'access_allowed' });

  const all = await expandCandidates(ctx.db, {
    targetType: target.targetType,
    targetId: target.targetId,
  });
  await log({ step: 'candidates_expand', acceptedCount: all.length });

  // Compute quota state for the upstream keys in the candidate list. M6.
  const now = new Date();
  const quotaExceeded = new Set<string>();
  for (const c of all) {
    if (quotaExceeded.has(c.upstreamKeyId)) continue;
    if (
      await wouldExceedQuota(ctx.db, {
        upstreamKeyId: c.upstreamKeyId,
        delta: { requests: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        now,
      })
    ) {
      quotaExceeded.add(c.upstreamKeyId);
    }
  }
  const { accepted, dropped, fallback } = filterCandidates(all, {
    sourceProtocol: streamCtx.sourceProtocol,
    now,
    quotaExceeded,
    rawRequest: streamCtx.ir.rawRequest,
  });
  await log({
    step: 'candidates_filter',
    acceptedCount: accepted.length,
    droppedCount: dropped.length,
    fallbackCount: fallback.length,
  });

  // Cross-protocol streaming is only safe when the upstream adapter can
  // translate its native SSE frames into the client protocol. Adapters declare
  // this via capabilities.protocols. Same-protocol candidates are always used;
  // cross-protocol candidates are only used when their adapter explicitly
  // supports the client protocol.
  const translatableFallback = fallback.filter((c) => {
    const adapter = getProviderAdapter(c);
    return adapter.capabilities.protocols.includes(streamCtx.sourceProtocol);
  });
  const usableCandidates = accepted.length > 0 ? accepted : translatableFallback;
  if (usableCandidates.length === 0) {
    if (fallback.length > 0) {
      await log({ step: 'request_complete', finalOutcome: 'error', latencyMs: Date.now() - start });
      throw new ValidationError('cross-protocol streaming is not supported yet');
    }
    await log({ step: 'request_complete', finalOutcome: 'error', latencyMs: Date.now() - start });
    throw new NoRouteAvailableError('no available upstream for target');
  }
  let sorted = [...usableCandidates].sort((a, b) => a.priority - b.priority);
  // Sticky binding lookup. If a fresh binding exists and the bound
  // candidate is still in the accepted set, honor it by moving it to
  // the front. We only consult sticky once per stream; if the bound
  // candidate turns out to be unhealthy after the first frame,
  // failover still kicks in.
  const fingerprint = conversationFingerprint({
    requestedModel: streamCtx.ir.requestedModel,
    system: streamCtx.ir.system,
    messages: streamCtx.ir.messages,
    metadataUserId: streamCtx.ir.metadata['user_id'] ?? null,
  });
  const stickyLookup = await lookupStickyBinding(ctx.db, {
    appId: ctx.appId,
    consumerKeyId: ctx.consumerKeyId,
    requestedTargetName: streamCtx.ir.requestedModel,
    fingerprint,
    now,
  });
  await log({ step: 'sticky_check' });
  let stickyHit = false;
  if (stickyLookup.binding && isStickyBindingValid(stickyLookup.binding, sorted, { now })) {
    const bound = sorted.find(
      (c) =>
        c.upstreamKeyId === stickyLookup.binding!.upstreamKeyId &&
        c.realModelName === stickyLookup.binding!.realModelName,
    );
    if (bound) {
      sorted = [bound, ...sorted.filter((c) => c !== bound)];
      stickyHit = true;
      void touchStickyBinding(ctx.db, { id: stickyLookup.binding.id, now });
      await log({ step: 'sticky_hit', upstreamKeyId: bound.upstreamKeyId, upstreamKeyName: bound.upstreamKeyName, realModelName: bound.realModelName });
    }
  }

  // Per-attempt AbortController. driveStream wires the client-disconnect
  // listener that aborts this so the upstream fetch (and its body reader)
  // is cancelled promptly. The AbortController is passed into driveStream
  // as `signal` so it owns the lifecycle.
  let abortController: AbortController | null = null;

  let started = false;
  let lastError: NormalizedErrorLite | null = null;
  let lastCandidate: ResolvedCandidate | null = null;
  let attempts = 0;

  for (const candidate of sorted) {
    lastCandidate = candidate;
    attempts += 1;
    await log({
      step: 'candidate_attempt',
      upstreamKeyId: candidate.upstreamKeyId,
      upstreamKeyName: candidate.upstreamKeyName,
      realModelName: candidate.realModelName,
      endpointProtocol: candidate.endpointProtocol,
      attemptOrder: attempts,
    });
    const adapter = getProviderAdapter(candidate);
    const providerReq = await buildProviderRequest(ctx, { ir: streamCtx.ir, candidate });
    abortController = new AbortController();
    const startResult = await startUpstreamStream(providerReq, {
      timeoutMs: ctx.defaultUpstreamTimeoutMs ?? 60_000,
      signal: abortController.signal,
    });
    if (startResult.kind === 'transport') {
      lastError = {
        category: 'provider_timeout',
        providerCode: null,
        providerMessage: startResult.error.message,
        upstreamStatus: 0,
      };
      await log({
        step: 'candidate_fail',
        upstreamKeyId: candidate.upstreamKeyId,
        upstreamKeyName: candidate.upstreamKeyName,
        realModelName: candidate.realModelName,
        attemptOrder: attempts,
        errorCategory: lastError.category,
        errorMessage: lastError.providerMessage ?? undefined,
      });
      await tryCooldown(
        ctx,
        candidate,
        lastError.category,
        lastError.providerCode,
        lastError.providerMessage,
      );
      if (!FAILOVER_CATEGORIES.has(lastError.category)) break;
      continue;
    }
    if (startResult.kind === 'error-body') {
      const providerError = adapter.normalizeError({
        response: {
          status: startResult.status,
          headers: startResult.headers,
          bodyText: startResult.bodyText,
          bodyJson: startResult.bodyJson,
          ttfbMs: 0,
        },
        request: providerCtxOf(streamCtx.ir, candidate, providerReq),
        transportError: undefined,
      });
      lastError = providerError;
      await log({
        step: 'candidate_fail',
        upstreamKeyId: candidate.upstreamKeyId,
        upstreamKeyName: candidate.upstreamKeyName,
        realModelName: candidate.realModelName,
        attemptOrder: attempts,
        httpStatus: startResult.status,
        errorCategory: providerError.category,
        errorCode: providerError.providerCode ?? undefined,
        errorMessage: providerError.providerMessage ?? undefined,
      });
      await tryCooldown(
        ctx,
        candidate,
        providerError.category,
        providerError.providerCode,
        providerError.providerMessage,
      );
      if (FAILOVER_CATEGORIES.has(providerError.category)) continue;
      throw toNormalizedError(providerError);
    }
    // startResult.kind === "ok": upstream is streaming.
    started = await driveStream({
      ctx,
      streamCtx,
      target,
      reply,
      adapter,
      candidate,
      start: startResult,
      abortController,
      stickyHit,
      fingerprint,
      traceId,
      log,
    });
    if (started) {
      return; // usage record already written by driveStream
    }
    // Stream did not start (client disconnected before any frame). Try
    // the next candidate.
    continue;
  }

  if (!started) {
    const fallbackErr: NormalizedErrorLite = lastError ?? {
      category: 'provider_unknown',
      providerCode: null,
      providerMessage: 'no upstream succeeded',
      upstreamStatus: 0,
    };
    if (lastCandidate) {
      await recordUsageOnFailure(
        ctx,
        streamCtx,
        target,
        lastCandidate,
        fallbackErr,
        Date.now() - start,
      );
    }
    await log({ step: 'request_complete', finalOutcome: 'error', latencyMs: Date.now() - start });
    throw toNormalizedError(fallbackErr);
  }
}

function toNormalizedError(err: NormalizedErrorLite): Error {
  switch (err.category) {
    case 'provider_rate_limit':
      return new ProviderRateLimitError(err.providerMessage ?? 'rate limited');
    case 'provider_quota':
      return new ProviderQuotaError(err.providerMessage ?? 'quota exhausted');
    case 'provider_timeout':
      return new ProviderTimeoutError(err.providerMessage ?? 'upstream timeout');
    case 'provider_stream_error':
      return new ProviderStreamError(err.providerMessage ?? 'stream error');
    default:
      return new ProviderError(err.providerMessage ?? 'upstream error');
  }
}

async function buildProviderRequest(
  ctx: StreamGatewayContext,
  args: { ir: ChatRequestIR; candidate: ResolvedCandidate },
): Promise<ProviderHttpRequest> {
  const authHeader = await resolveAuthorizationHeader({
    row: {
      id: args.candidate.upstreamKeyId,
      authType: args.candidate.authType,
      apiKeyCiphertext: args.candidate.apiKeyCiphertext,
      authConfigCiphertext: args.candidate.authConfigCiphertext,
    },
    secretKey: ctx.secretKey,
    baseUrl: args.candidate.endpointBaseUrl,
    db: ctx.db,
  });
  const providerCtx: ProviderRequestContext = {
    ir: args.ir,
    realModelName: args.candidate.realModelName,
    upstreamKeyId: args.candidate.upstreamKeyId,
    timeoutMs: ctx.defaultUpstreamTimeoutMs ?? 60_000,
    stream: true,
    baseUrl: args.candidate.endpointBaseUrl,
    apiPath: args.candidate.endpointApiPath,
    apiKey: authHeader.replace(/^Bearer\s+/i, ''),
    extraHeaders: args.candidate.extraHeaders,
    extraParams: args.candidate.extraParams,
  };
  return getProviderAdapter(args.candidate).buildRequest(providerCtx);
}

function providerCtxOf(
  ir: ChatRequestIR,
  candidate: ResolvedCandidate,
  request: ProviderHttpRequest,
): ProviderRequestContext {
  return {
    ir,
    realModelName: candidate.realModelName,
    upstreamKeyId: candidate.upstreamKeyId,
    timeoutMs: 0,
    stream: true,
    baseUrl: request.url,
    apiKey: '',
    extraHeaders: candidate.extraHeaders,
    extraParams: candidate.extraParams,
  };
}

interface DriveStreamArgs {
  ctx: StreamGatewayContext;
  streamCtx: StreamRequestContext;
  target: ResolvedTarget;
  reply: FastifyReply;
  adapter: ProviderAdapter;
  candidate: ResolvedCandidate;
  start: StreamStart;
  abortController: AbortController;
  stickyHit: boolean;
  fingerprint: string;
  traceId: string;
  log: (input: Omit<import('../observability/trace-logs.js').TraceLogEntryInput, 'requestTraceId' | 'stepIndex'> & { step: import('../observability/trace-logs.js').TraceStep }) => Promise<void>;
}

// Returns true once any frame has been written to the client; false if the
// stream ended before the first frame (e.g. client disconnected). In both
// cases the usage record is written before the function returns.
async function driveStream(args: DriveStreamArgs): Promise<boolean> {
  const {
    ctx,
    streamCtx,
    target,
    reply,
    adapter,
    candidate,
    start,
    abortController,
    stickyHit,
    fingerprint,
    traceId,
    log,
  } = args;
  if (start.kind !== 'ok') {
    throw new Error('driveStream called with non-ok start');
  }
  const startedAt = Date.now();
  const usageBag: {
    value: { inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens: number; cacheWriteTokens: number } | null;
  } = { value: null };
  let lastError: NormalizedErrorLite | null = null;
  let clientDisconnected = false;
  let closedByUpstream = false;
  let firstWrite = false;

  await log({ step: 'stream_start', upstreamKeyId: candidate.upstreamKeyId, upstreamKeyName: candidate.upstreamKeyName, realModelName: candidate.realModelName });

  // Single client-disconnect listener. The handler may have registered
  // an earlier listener on the same socket (it owns the route-level
  // cleanup); this one is the per-stream one. Both fire on close and we
  // only need this one to do the abort + bookkeeping.
  //
  // We only treat `close` as a client-initiated disconnect if it happens
  // BEFORE we have finalized the response ourselves (i.e. before
  // `closedByUpstream` flips to true at the end of the upstream
  // iterator). The natural end of a stream — `data: [DONE]` from OpenAI
  // or `message_stop` from Anthropic — also triggers a `close` on the
  // reply socket once we call `reply.raw.end()`; that path is a clean
  // completion, not a disconnect.
  const onClientClose = (): void => {
    if (closedByUpstream) return;
    clientDisconnected = true;
    try {
      abortController.abort();
    } catch {
      /* ignore */
    }
    try {
      reply.raw.destroy();
    } catch {
      /* ignore */
    }
  };
  reply.raw.once('close', onClientClose);

  try {
    for await (const raw of start.events) {
      if (abortController.signal.aborted) break;
      const result = adapter.normalizeStreamEvent({
        event: raw.event,
        data: raw.data,
        request: providerCtxOf(streamCtx.ir, candidate, {
          url: '',
          method: 'POST',
          headers: {},
          body: '',
        }),
        sourceProtocol: streamCtx.sourceProtocol,
      });
      if (result.kind === 'usage') {
        // Merge across events. The Anthropic adapter sets inputTokens
        // to -1 to signal "keep the previously captured input_tokens
        // from message_start". Output tokens from message_delta are
        // always the final value; totalTokens is recomputed.
        const prev = usageBag.value;
        const inputTokens =
          result.inputTokens === -1 ? (prev?.inputTokens ?? 0) : result.inputTokens;
        const outputTokens = result.outputTokens;
        const cacheReadTokens =
          result.cacheReadTokens !== undefined
            ? (result.cacheReadTokens === -1 ? (prev?.cacheReadTokens ?? 0) : result.cacheReadTokens)
            : (prev?.cacheReadTokens ?? 0);
        const cacheWriteTokens =
          result.cacheWriteTokens !== undefined
            ? (result.cacheWriteTokens === -1 ? (prev?.cacheWriteTokens ?? 0) : result.cacheWriteTokens)
            : (prev?.cacheWriteTokens ?? 0);
        usageBag.value = {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        };
      }
      if (!firstWrite) {
        writeStreamHeaders(reply, start.headers, traceId);
        firstWrite = true;
      }
      const frames = result.clientFrame ?? raw;
      if (Array.isArray(frames)) {
        for (const frame of frames) {
          writeStreamFrame(reply, frame);
        }
      } else {
        writeStreamFrame(reply, frames);
      }
    }
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === 'AbortError') {
      clientDisconnected = true;
    } else {
      lastError = {
        category: 'provider_stream_error',
        providerCode: null,
        providerMessage: e.message ?? 'stream failed',
        upstreamStatus: 200,
      };
    }
  } finally {
    // Mark the stream as finished on our side before we finalize the
    // response. Calling `reply.raw.end()` will emit a `close` event on
    // the reply socket; the listener treats that as a no-op so a clean
    // completion is never recorded as a client disconnect.
    closedByUpstream = true;
    if (firstWrite) {
      try {
        reply.raw.end();
      } catch {
        /* ignore */
      }
    }
    reply.raw.off('close', onClientClose);
  }

  const latencyMs = Date.now() - startedAt;
  if (clientDisconnected) {
    // The client gave up mid-stream. Record the cancellation so usage
    // aggregation still sees the request — the upstream was tried and
    // may have been billed by the provider. Latency is measured to the
    // disconnect.
    await recordUsageOnFailure(ctx, streamCtx, target, candidate, CLIENT_DISCONNECTED, latencyMs);
    return firstWrite;
  }
  if (lastError) {
    await recordUsageOnFailure(ctx, streamCtx, target, candidate, lastError, latencyMs);
  } else {
    await recordUsageOnSuccess(
      ctx,
      streamCtx,
      target,
      candidate,
      usageBag.value,
      latencyMs,
      stickyHit,
    );
    const usageTokens = usageBag.value ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const stickyNow = new Date();
    // Bump every configured period for this upstream key so hour/day/week/
    // month caps actually trigger freezes. `recordQuotaUsage` also bumps
    // the running `total` counter for the dashboard. We await the write
    // so the freeze logic on the next request sees a consistent counter;
    // a DB failure is still swallowed and never changes the response the
    // client has already received.
    try {
      const periods = await getEnabledQuotaPeriods(ctx.db, candidate.upstreamKeyId);
      await recordQuotaUsage(ctx.db, {
        upstreamKeyId: candidate.upstreamKeyId,
        delta: {
          requests: 1,
          inputTokens: usageTokens.inputTokens,
          outputTokens: usageTokens.outputTokens,
          totalTokens: usageTokens.totalTokens,
        },
        periods,
        now: stickyNow,
      });
    } catch {
      /* quota is best-effort */
    }
    // Update daily consumption stats (M8). Best-effort.
    try {
      await upsertConsumptionStats(ctx.db, {
        upstreamKeyId: candidate.upstreamKeyId,
        realModelName: candidate.realModelName,
        delta: {
          requestCount: 1,
          successCount: 1,
          errorCount: 0,
          cacheReadTokens: usageTokens.cacheReadTokens ?? 0,
          cacheWriteTokens: usageTokens.cacheWriteTokens ?? 0,
          inputTokens: usageTokens.inputTokens,
          outputTokens: usageTokens.outputTokens,
          totalTokens: usageTokens.totalTokens,
          latencyMs,
        },
        now: stickyNow,
      });
    } catch {
      /* consumption stats are best-effort */
    }
    // Sticky binding stays fire-and-forget: a missing or stale binding
    // only causes the next request to pick a fresh candidate.
    void upsertStickyBinding(ctx.db, {
      appId: ctx.appId,
      consumerKeyId: ctx.consumerKeyId,
      requestedTargetName: streamCtx.ir.requestedModel,
      fingerprint,
      upstreamKeyId: candidate.upstreamKeyId,
      realModelName: candidate.realModelName,
      now: stickyNow,
    });
    await log({ step: 'stream_end', upstreamKeyId: candidate.upstreamKeyId, upstreamKeyName: candidate.upstreamKeyName, realModelName: candidate.realModelName, latencyMs: Date.now() - startedAt });
  }
  return firstWrite;
}

function writeStreamHeaders(reply: FastifyReply, upstreamHeaders: Record<string, string>, traceId?: string): void {
  reply.hijack();
  reply.raw.statusCode = 200;
  reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
  reply.raw.setHeader('cache-control', 'no-cache');
  reply.raw.setHeader('connection', 'keep-alive');
  reply.raw.setHeader('x-accel-buffering', 'no');
  const requestId = upstreamHeaders['x-request-id'];
  if (requestId) reply.raw.setHeader('x-request-id', requestId);
  if (traceId) reply.raw.setHeader('x-request-trace-id', traceId);
}

function writeStreamFrame(
  reply: FastifyReply,
  frame: RawStreamEvent | { event?: string; data: string },
): void {
  let text = '';
  if (frame.event) {
    text += `event: ${frame.event}\n`;
  }
  const dataLines = frame.data.split('\n');
  for (const line of dataLines) {
    text += `data: ${line}\n`;
  }
  text += '\n';
  reply.raw.write(text);
}

async function tryCooldown(
  ctx: StreamGatewayContext,
  candidate: ResolvedCandidate,
  category: string,
  providerCode: string | null,
  providerMessage: string | null,
): Promise<void> {
  if (!shouldCooldown(category as Parameters<typeof shouldCooldown>[0])) return;
  try {
    await applyCooldown(ctx.db, {
      upstreamKeyId: candidate.upstreamKeyId,
      update: computeCooldownUpdate(
        category as Parameters<typeof computeCooldownUpdate>[0],
        providerCode,
        providerMessage,
        new Date(),
      ),
    });
  } catch {
    /* best-effort */
  }
}

async function recordUsageOnSuccess(
  ctx: StreamGatewayContext,
  streamCtx: StreamRequestContext,
  target: ResolvedTarget,
  candidate: ResolvedCandidate,
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens: number; cacheWriteTokens: number } | null,
  latencyMs: number,
  stickyHit: boolean,
): Promise<void> {
  await writeUsageRecord(ctx.db, {
    appId: ctx.appId,
    consumerKeyId: ctx.consumerKeyId,
    requestedTargetName: streamCtx.ir.requestedModel,
    resolvedTargetType: target.targetType,
    resolvedTargetId: target.targetId,
    upstreamKeyId: candidate.upstreamKeyId,
    realModelName: candidate.realModelName,
    sourceProtocol: streamCtx.sourceProtocol,
    providerType: candidate.providerType,
    stream: true,
    stickyHit,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null,
    cacheWriteTokens: usage?.cacheWriteTokens ?? null,
    status: 'success',
    errorCode: null,
    latencyMs,
  });
}

async function recordUsageOnFailure(
  ctx: StreamGatewayContext,
  streamCtx: StreamRequestContext,
  target: ResolvedTarget,
  candidate: ResolvedCandidate,
  err: NormalizedErrorLite,
  latencyMs: number,
): Promise<void> {
  await writeUsageRecord(ctx.db, {
    appId: ctx.appId,
    consumerKeyId: ctx.consumerKeyId,
    requestedTargetName: streamCtx.ir.requestedModel,
    resolvedTargetType: target.targetType,
    resolvedTargetId: target.targetId,
    upstreamKeyId: candidate.upstreamKeyId,
    realModelName: candidate.realModelName,
    sourceProtocol: streamCtx.sourceProtocol,
    providerType: candidate.providerType,
    stream: true,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    status: 'error',
    errorCode: err.providerCode ?? err.category,
    latencyMs,
  });
}

export function buildStreamRequest(
  protocol: 'anthropic' | 'openai' | 'codex',
  body: unknown,
): StreamRequestContext {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  if (typeof b['model'] !== 'string') throw new ValidationError('model is required');
  if (b['stream'] !== true) {
    throw new ValidationError('this entry point is only for stream: true requests');
  }
  if (protocol === 'codex') {
    if (typeof b['input'] !== 'string' && !Array.isArray(b['input'])) {
      throw new ValidationError('input is required');
    }
    return {
      ir: codexRequestToIR(b as Parameters<typeof codexRequestToIR>[0], body),
      sourceProtocol: 'codex',
    };
  }
  if (!Array.isArray(b['messages'])) throw new ValidationError('messages is required');
  if (protocol === 'anthropic') {
    return {
      ir: anthropicRequestToIR(b as Parameters<typeof anthropicRequestToIR>[0], body),
      sourceProtocol: 'anthropic',
    };
  }
  return {
    ir: openaiRequestToIR(b as Parameters<typeof openaiRequestToIR>[0], body),
    sourceProtocol: 'openai',
  };
}

export { TargetNotFoundError };
