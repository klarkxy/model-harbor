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
  getAdapter,
} from '../providers/index.js';
import { type Db } from '../db/index.js';
import { decryptSecret } from '../auth/crypto.js';
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
  category: string;
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

  const target = await resolveTargetByName(ctx.db, streamCtx.ir.requestedModel);
  await assertConsumerKeyAccess(ctx.db, {
    consumerKeyId: ctx.consumerKeyId,
    targetType: target.targetType,
    targetId: target.targetId,
  });
  const all = await expandCandidates(ctx.db, {
    targetType: target.targetType,
    targetId: target.targetId,
  });
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
  const { accepted, fallback } = filterCandidates(all, {
    sourceProtocol: streamCtx.sourceProtocol,
    now,
    quotaExceeded,
  });
  // Streaming currently forwards upstream SSE frames verbatim. Cross-protocol
  // streaming would require parsing and re-emitting frames in the client
  // protocol, which is not implemented yet. Surface a clear error instead of
  // silently sending the wrong wire format.
  if (accepted.length === 0 && fallback.length > 0) {
    throw new ValidationError('cross-protocol streaming is not supported yet');
  }
  if (accepted.length === 0) {
    throw new NoRouteAvailableError('no available upstream for target');
  }
  let sorted = [...accepted].sort((a, b) => a.priority - b.priority);
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

  for (const candidate of sorted) {
    lastCandidate = candidate;
    const adapter = getAdapter(candidate.providerType);
    const providerReq = buildProviderRequest(ctx, { ir: streamCtx.ir, candidate });
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
        },
        request: providerCtxOf(streamCtx.ir, candidate, providerReq),
        transportError: undefined,
      });
      lastError = providerError;
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
    });
    if (started) {
      return; // usage record already written by driveStream
    }
    // Stream did not start (client disconnected before any frame). Try
    // the next candidate.
    continue;
  }

  if (!started) {
    const fallback: NormalizedErrorLite = lastError ?? {
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
        fallback,
        Date.now() - start,
      );
    }
    throw toNormalizedError(fallback);
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

function buildProviderRequest(
  ctx: StreamGatewayContext,
  args: { ir: ChatRequestIR; candidate: ResolvedCandidate },
): ProviderHttpRequest {
  const apiKey = decryptSecret(args.candidate.apiKeyCiphertext, ctx.secretKey);
  const providerCtx: ProviderRequestContext = {
    ir: args.ir,
    realModelName: args.candidate.realModelName,
    upstreamKeyId: args.candidate.upstreamKeyId,
    timeoutMs: ctx.defaultUpstreamTimeoutMs ?? 60_000,
    stream: true,
    baseUrl: args.candidate.endpointBaseUrl,
    apiPath: args.candidate.endpointApiPath,
    apiKey,
  };
  return getAdapter(args.candidate.providerType).buildRequest(providerCtx);
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
  } = args;
  if (start.kind !== 'ok') {
    throw new Error('driveStream called with non-ok start');
  }
  const startedAt = Date.now();
  const usageBag: {
    value: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
  } = { value: null };
  let lastError: NormalizedErrorLite | null = null;
  let clientDisconnected = false;
  let closedByUpstream = false;
  let firstWrite = false;

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
        usageBag.value = {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        };
      }
      if (!firstWrite) {
        writeStreamHeaders(reply, start.headers);
        firstWrite = true;
      }
      writeStreamFrame(reply, raw);
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
    const usageTokens = usageBag.value ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
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
  }
  return firstWrite;
}

function writeStreamHeaders(reply: FastifyReply, upstreamHeaders: Record<string, string>): void {
  reply.hijack();
  reply.raw.statusCode = 200;
  reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
  reply.raw.setHeader('cache-control', 'no-cache');
  reply.raw.setHeader('connection', 'keep-alive');
  reply.raw.setHeader('x-accel-buffering', 'no');
  const requestId = upstreamHeaders['x-request-id'];
  if (requestId) reply.raw.setHeader('x-request-id', requestId);
}

function writeStreamFrame(reply: FastifyReply, raw: RawStreamEvent): void {
  let frame = '';
  if (raw.event) {
    frame += `event: ${raw.event}\n`;
  }
  const dataLines = raw.data.split('\n');
  for (const line of dataLines) {
    frame += `data: ${line}\n`;
  }
  frame += '\n';
  reply.raw.write(frame);
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
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null,
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
    status: 'error',
    errorCode: err.providerCode ?? err.category,
    latencyMs,
  });
}

export function buildStreamRequest(
  protocol: 'anthropic' | 'openai',
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
