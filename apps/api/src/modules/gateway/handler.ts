import {
  type ChatRequestIR,
  type NormalizedChatResponse,
  type ProviderType,
  type SourceProtocol,
  AuthenticationError,
  NoRouteAvailableError,
  PermissionError,
  ProviderError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderStreamError,
  ProviderTimeoutError,
  TargetNotFoundError,
  ValidationError,
  isNormalizedError,
} from '@modelharbor/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { upstreamKeys } from '../db/tables/upstream.js';
import { resolveAuthorizationHeader } from '../providers/auth/index.js';
import {
  type ResolvedCandidate,
  expandCandidates,
  filterCandidates,
} from '../router/candidates.js';
import { maybeBalanceGroupCandidates } from '../router/group-balancer.js';
import { assertConsumerKeyAccess } from '../router/access.js';
import {
  type CircuitBreakerSettings,
  getCircuitBreakerSettings,
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
} from '../router/circuit-breaker.js';
import { resolveTargetByName } from '../router/resolve.js';
import {
  type NormalizedProviderError,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type ProviderRequestContext,
  type ProviderAdapter,
  anthropicRequestToIR,
  openaiRequestToIR,
  codexRequestToIR,
  getProviderAdapter,
} from '../providers/index.js';
import { sendUpstreamRequest, type SendOutcome } from './sender.js';
import { writeUsageRecord } from '../usage/index.js';
import { writeContentLog } from '../observability/content-logs.js';
import { applyCooldown, computeCooldownUpdate, shouldCooldown } from './cooldown.js';
import {
  conversationFingerprint,
  isStickyBindingValid,
  lookupStickyBinding,
  touchStickyBinding,
  upsertStickyBinding,
} from '../sticky/index.js';
import {
  getStickySessionTtlMs,
  isStickySessionValid,
  lookupStickySession,
  touchStickySession,
  upsertStickySession,
} from '../sticky/session.js';
import { getEnabledQuotaPeriods, recordQuotaUsage, wouldExceedQuota } from '../quota/index.js';
import {
  getEndpointHealthForUpstreamKeyIds,
  sortCandidatesByLatency,
} from '../upstream/endpoint-health.js';
import {
  generateTraceId,
  writeTraceLogEntry,
  upsertConsumptionStats,
} from '../observability/index.js';

export interface GatewayRequestContext {
  db: Db;
  secretKey: string;
  consumerKeyId: string;
  appId: string;
  timeoutMs?: number;
  defaultUpstreamTimeoutMs?: number;
  traceId?: string;
}

export interface GatewaySuccess {
  ok: true;
  ir: NormalizedChatResponse;
  candidate: ResolvedCandidate;
  adapterType: ProviderType;
  providerResponse: ProviderHttpResponse;
}

export interface GatewayError {
  ok: false;
  // Always set on the error path. Carries the wire-format details so the route
  // handler can shape the response.
  providerError: NormalizedProviderError;
  lastCandidate: ResolvedCandidate | null;
  attempts: number;
}

export type GatewayOutcome = GatewaySuccess | GatewayError;

const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;
// Cap the per-request failover fan-out. Even with a long candidate list
// and a global outage, a single request should not pay N sequential
// upstream latencies. 8 covers most realistic multi-region setups while
// keeping a 1-minute default upstream budget at 7-8s per attempt.
const MAX_FAILOVER_ATTEMPTS = 8;
const FAILOVER_CATEGORIES: ReadonlySet<NormalizedProviderError['category']> = new Set([
  'provider_rate_limit',
  'provider_quota',
  'provider_overloaded',
  'provider_timeout',
]);

// Walk the candidate list in priority order. On a failover-eligible error,
// apply a brief cooldown and try the next candidate. On any other error (auth,
// permission, model_not_found, bad_request, transport) stop immediately and
// return that error to the caller.
async function tryCandidates(
  ctx: GatewayRequestContext,
  args: {
    ir: ChatRequestIR;
    sourceProtocol: SourceProtocol;
    candidates: ResolvedCandidate[];
    traceId: string;
    log: (
      input: Omit<
        import('../observability/trace-logs.js').TraceLogEntryInput,
        'requestTraceId' | 'stepIndex'
      > & { step: import('../observability/trace-logs.js').TraceStep },
    ) => Promise<void>;
    cbSettings: CircuitBreakerSettings;
  },
): Promise<GatewayOutcome> {
  let lastError: NormalizedProviderError | null = null;
  let lastCandidate: ResolvedCandidate | null = null;
  let attempts = 0;

  for (const candidate of args.candidates) {
    lastCandidate = candidate;
    attempts += 1;
    if (attempts > MAX_FAILOVER_ATTEMPTS) {
      // Cap the fan-out per request. We stop walking the candidate list and
      // surface the most recent failover-eligible error to the caller.
      // Subsequent requests will benefit from the cooldown we just applied
      // to the candidates we did try, so they skip them automatically.
      break;
    }
    await args.log({
      step: 'candidate_attempt',
      upstreamKeyId: candidate.upstreamKeyId,
      upstreamKeyName: candidate.upstreamKeyName,
      realModelName: candidate.realModelName,
      endpointProtocol: candidate.endpointProtocol,
      attemptOrder: attempts,
    });
    const adapter = getProviderAdapter(candidate);
    const request = await buildHttpRequest(ctx, { ir: args.ir, candidate, adapter });
    const outcome = await sendUpstreamRequest(request, {
      timeoutMs: ctx.defaultUpstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
    });

    const classified = classifyOutcome(adapter, { outcome, request, ir: args.ir });
    if (classified.kind === 'error') {
      await args.log({
        step: 'candidate_fail',
        upstreamKeyId: candidate.upstreamKeyId,
        upstreamKeyName: candidate.upstreamKeyName,
        realModelName: candidate.realModelName,
        attemptOrder: attempts,
        httpStatus: outcome.response?.status,
        errorCategory: classified.error.category,
        errorCode: classified.error.providerCode ?? undefined,
        errorMessage: classified.error.providerMessage ?? undefined,
      });
    }
    if (classified.kind === 'success') {
      await args.log({
        step: 'candidate_success',
        upstreamKeyId: candidate.upstreamKeyId,
        upstreamKeyName: candidate.upstreamKeyName,
        realModelName: candidate.realModelName,
        attemptOrder: attempts,
        httpStatus: outcome.response?.status,
      });
      const cbTransition = await recordCircuitBreakerSuccess(ctx.db, {
        upstreamKeyId: candidate.upstreamKeyId,
        realModelName: candidate.realModelName,
        now: new Date(),
        settings: args.cbSettings,
      });
      if (cbTransition) {
        await args.log({
          step: `circuit_breaker_${cbTransition.newState}` as import('../observability/trace-logs.js').TraceStep,
          upstreamKeyId: candidate.upstreamKeyId,
          upstreamKeyName: candidate.upstreamKeyName,
          realModelName: candidate.realModelName,
        });
      }
      return {
        ok: true,
        ir: classified.response,
        candidate,
        adapterType: candidate.providerType,
        providerResponse: classified.raw,
      };
    }
    lastError = classified.error;
    const cbTransition = await recordCircuitBreakerFailure(ctx.db, {
      upstreamKeyId: candidate.upstreamKeyId,
      realModelName: candidate.realModelName,
      error: classified.error,
      now: new Date(),
      settings: args.cbSettings,
    });
    if (cbTransition) {
      await args.log({
        step: `circuit_breaker_${cbTransition.newState}` as import('../observability/trace-logs.js').TraceStep,
        upstreamKeyId: candidate.upstreamKeyId,
        upstreamKeyName: candidate.upstreamKeyName,
        realModelName: candidate.realModelName,
        errorCategory: classified.error.category,
        errorCode: classified.error.providerCode ?? undefined,
        errorMessage: classified.error.providerMessage ?? undefined,
      });
    }

    // Apply cooldown for upstream-reported back-pressure. Failover-eligible
    // errors also let us try the next candidate in the same request.
    if (shouldCooldown(classified.error.category)) {
      try {
        await applyCooldown(ctx.db, {
          upstreamKeyId: candidate.upstreamKeyId,
          update: computeCooldownUpdate(
            classified.error.category,
            classified.error.providerCode,
            classified.error.providerMessage,
            new Date(),
          ),
        });
        await args.log({
          step: 'cooldown_applied',
          upstreamKeyId: candidate.upstreamKeyId,
          upstreamKeyName: candidate.upstreamKeyName,
          realModelName: candidate.realModelName,
        });
      } catch {
        // Cooldown is best-effort; never let a DB write failure surface to
        // the client.
      }
    }
    if (!FAILOVER_CATEGORIES.has(classified.error.category)) {
      // Non-recoverable in this request. Return the error to the caller.
      return { ok: false, providerError: classified.error, lastCandidate, attempts };
    }
  }

  // All candidates tried.
  if (lastError) {
    return { ok: false, providerError: lastError, lastCandidate, attempts };
  }
  // Should not happen (we checked length earlier), but be defensive.
  throw new NoRouteAvailableError('no available upstream');
}

async function buildHttpRequest(
  ctx: GatewayRequestContext,
  args: { ir: ChatRequestIR; candidate: ResolvedCandidate; adapter: ProviderAdapter },
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
  // Preserve legacy adapter contract: the Authorization header value is passed as
  // apiKey; adapters for PAT providers place it in the expected header.
  const providerCtx: ProviderRequestContext = {
    ir: args.ir,
    realModelName: args.candidate.realModelName,
    upstreamKeyId: args.candidate.upstreamKeyId,
    timeoutMs: ctx.defaultUpstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
    stream: args.ir.stream,
    baseUrl: args.candidate.endpointBaseUrl,
    apiPath: args.candidate.endpointApiPath,
    apiKey: authHeader.replace(/^Bearer\s+/i, ''),
    extraHeaders: args.candidate.extraHeaders,
    extraParams: args.candidate.extraParams,
  };
  return args.adapter.buildRequest(providerCtx);
}

type ClassifiedOutcome =
  | { kind: 'success'; response: NormalizedChatResponse; raw: ProviderHttpResponse }
  | { kind: 'error'; error: NormalizedProviderError };

function classifyOutcome(
  adapter: ProviderAdapter,
  args: { outcome: SendOutcome; request: ProviderHttpRequest; ir: ChatRequestIR },
): ClassifiedOutcome {
  const response = args.outcome.response;
  if (response) {
    if (response.status >= 200 && response.status < 300) {
      try {
        const ir = adapter.normalizeResponse({ response, request: requestToContext(args.request) });
        return { kind: 'success', response: ir, raw: response };
      } catch (err) {
        // normalizeResponse threw — treat as provider error.
        const providerError: NormalizedProviderError = {
          category: 'provider_unknown',
          providerMessage: err instanceof Error ? err.message : String(err),
          providerCode: null,
          upstreamStatus: response.status,
        };
        return { kind: 'error', error: providerError };
      }
    }
    const error = adapter.normalizeError({
      response,
      request: requestToContext(args.request),
      transportError: undefined,
    });
    return { kind: 'error', error };
  }
  const error = adapter.normalizeError({
    response: undefined,
    request: requestToContext(args.request),
    transportError: args.outcome.transportError,
  });
  return { kind: 'error', error };
}

// Re-build a ProviderRequestContext from a request that was already sent. The
// sender doesn't carry the context (it only sees the wire-format request), so
// the gateway reconstructs the minimum needed for adapter helpers.
//
// This is a best-effort stub used by `normalizeError` and `normalizeResponse`
// on the response / failure path; the IR fields are blank because the
// original IR has already been flattened into the wire-format body in
// `request.body`. Adapter code that walks `context.ir` on the request build
// path is not reachable from this stub.
function requestToContext(request: ProviderHttpRequest): ProviderRequestContext {
  return {
    ir: {
      sourceProtocol: 'anthropic',
      requestedModel: '',
      system: null,
      messages: [],
      maxTokens: null,
      temperature: null,
      topP: null,
      stream: false,
      metadata: {},
      rawRequest: null,
    },
    realModelName: '',
    upstreamKeyId: '',
    timeoutMs: 0,
    stream: false,
    baseUrl: request.url,
    apiKey: '',
  };
}

// Convert a NormalizedProviderError into the closest NormalizedError class
// from the shared package. The route handler throws this so the existing
// error handler can pick the right status code + body shape.
export function providerErrorToNormalized(err: NormalizedProviderError): Error {
  switch (err.category) {
    case 'provider_rate_limit':
      return new ProviderRateLimitError(err.providerMessage ?? 'rate limited');
    case 'provider_quota':
      return new ProviderQuotaError(err.providerMessage ?? 'quota exhausted');
    case 'provider_timeout':
      return new ProviderTimeoutError(err.providerMessage ?? 'upstream timeout');
    case 'provider_stream_error':
      return new ProviderStreamError(err.providerMessage ?? 'stream error');
    case 'provider_authentication':
    case 'provider_permission':
    case 'provider_overloaded':
    case 'provider_model_not_found':
    case 'provider_bad_request':
    case 'provider_unknown':
    default:
      return new ProviderError(err.providerMessage ?? 'upstream error');
  }
}

// Convert an Anthropic Messages wire-format request into a gateway outcome.
export async function handleAnthropicRequest(
  body: unknown,
  ctx: GatewayRequestContext,
): Promise<GatewayOutcome> {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  if (typeof b['model'] !== 'string') throw new ValidationError('model is required');
  if (b['stream'] === true) {
    // The route handler at /v1/messages dispatches stream: true requests to
    // handleStreamRequest before reaching this function. If we are here, the
    // dispatcher was bypassed; reject so the caller gets a clear validation
    // error instead of a partial / non-streaming response.
    throw new ValidationError('streaming requests must use the streaming code path');
  }
  if (!Array.isArray(b['messages'])) throw new ValidationError('messages is required');
  const ir = anthropicRequestToIR(b as Parameters<typeof anthropicRequestToIR>[0], body);
  return runGateway(ir, 'anthropic', ctx);
}

// Convert an OpenAI Chat Completions wire-format request into a gateway
// outcome.
export async function handleOpenAIRequest(
  body: unknown,
  ctx: GatewayRequestContext,
): Promise<GatewayOutcome> {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  if (typeof b['model'] !== 'string') throw new ValidationError('model is required');
  if (b['stream'] === true) {
    // See the matching note in handleAnthropicRequest: the route handler
    // dispatches stream: true requests to the streaming code path first.
    throw new ValidationError('streaming requests must use the streaming code path');
  }
  if (!Array.isArray(b['messages'])) throw new ValidationError('messages is required');
  const ir = openaiRequestToIR(b as Parameters<typeof openaiRequestToIR>[0], body);
  return runGateway(ir, 'openai', ctx);
}

// Convert an OpenAI Responses API (Codex / GPT-5.5+) wire-format request into a
// gateway outcome.
export async function handleCodexRequest(
  body: unknown,
  ctx: GatewayRequestContext,
): Promise<GatewayOutcome> {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  if (typeof b['model'] !== 'string') throw new ValidationError('model is required');
  if (b['stream'] === true) {
    // Streaming Responses API requests use the streaming code path, just like
    // the other gateway routes.
    throw new ValidationError('streaming requests must use the streaming code path');
  }
  if (typeof b['input'] !== 'string' && !Array.isArray(b['input'])) {
    throw new ValidationError('input is required');
  }
  const ir = codexRequestToIR(b as Parameters<typeof codexRequestToIR>[0], body);
  return runGateway(ir, 'codex', ctx);
}

async function runGateway(
  ir: ChatRequestIR,
  sourceProtocol: SourceProtocol,
  ctx: GatewayRequestContext,
): Promise<GatewayOutcome> {
  const start = Date.now();
  const now = new Date();
  const traceId = ctx.traceId ?? generateTraceId();
  let stepIndex = 0;
  const log = (
    input: Omit<
      import('../observability/trace-logs.js').TraceLogEntryInput,
      'requestTraceId' | 'stepIndex'
    > & { step: import('../observability/trace-logs.js').TraceStep },
  ) =>
    writeTraceLogEntry(ctx.db, { ...input, requestTraceId: traceId, stepIndex: ++stepIndex, now });

  await log({
    step: 'request_start',
    appId: ctx.appId,
    consumerKeyId: ctx.consumerKeyId,
    requestedTargetName: ir.requestedModel,
    sourceProtocol,
  });

  // 1. Resolve target name to (type, id). Throws TargetNotFoundError on miss.
  const target = await resolveTargetByName(ctx.db, ir.requestedModel);
  await log({
    step: 'target_resolve',
    resolvedTargetType: target.targetType,
    resolvedTargetId: target.targetId,
  });

  // 2. Make sure the consumer key is allowed to call this target.
  await assertConsumerKeyAccess(ctx.db, {
    consumerKeyId: ctx.consumerKeyId,
    targetType: target.targetType,
    targetId: target.targetId,
  });
  await log({ step: 'access_allowed' });

  // 3. Expand + filter candidates. The router computes the set of upstream
  // keys that are currently over quota (M6) and passes it to the filter.
  const all = await expandCandidates(ctx.db, {
    targetType: target.targetType,
    targetId: target.targetId,
  });
  await log({ step: 'candidates_expand', acceptedCount: all.length });
  // Compute quota state for the upstream keys in the candidate list. The check
  // is conservative: if any configured quota on the key is currently
  // exhausted, the key is dropped from the accepted set.
  const upstreamIds = Array.from(new Set(all.map((c) => c.upstreamKeyId)));
  const quotaExceeded = new Set<string>();
  for (const id of upstreamIds) {
    if (
      await wouldExceedQuota(ctx.db, {
        upstreamKeyId: id,
        delta: { requests: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        now,
      })
    ) {
      quotaExceeded.add(id);
    }
  }
  const cbSettings = await getCircuitBreakerSettings(ctx.db);
  const { accepted, dropped, fallback } = await filterCandidates(ctx.db, all, {
    sourceProtocol,
    now,
    quotaExceeded,
    rawRequest: ir.rawRequest,
    settings: cbSettings,
  });
  await log({
    step: 'candidates_filter',
    acceptedCount: accepted.length,
    droppedCount: dropped.length,
    fallbackCount: fallback.length,
  });
  let usableCandidates = accepted.length > 0 ? accepted : fallback;
  if (usableCandidates.length > 0) {
    const healthRows = await getEndpointHealthForUpstreamKeyIds(
      ctx.db,
      Array.from(new Set(usableCandidates.map((c) => c.upstreamKeyId))),
    );
    usableCandidates = sortCandidatesByLatency(usableCandidates, healthRows);
  }
  if (usableCandidates.length === 0) {
    await log({ step: 'request_complete', finalOutcome: 'error', latencyMs: Date.now() - start });
    throw new NoRouteAvailableError('no available upstream for target');
  }

  // 4. Model group load balancing. Runs after health sorting and before sticky
  // checks; sticky bindings still override the balancer's choice.
  const balanceResult = await maybeBalanceGroupCandidates(ctx.db, target, usableCandidates, now);
  usableCandidates = balanceResult.candidates;
  if (balanceResult.mode) {
    await log({ step: 'group_balance', balanceMode: balanceResult.mode });
  }

  // 5. Sticky binding lookup. If a fresh binding exists and the bound
  // candidate is still in the accepted set, honor it by moving it to the
  // front of the candidate list.
  const fingerprint = conversationFingerprint({
    requestedModel: ir.requestedModel,
    system: ir.system,
    messages: ir.messages,
    metadataUserId: ir.metadata['user_id'] ?? null,
  });
  const stickyLookup = await lookupStickyBinding(ctx.db, {
    appId: ctx.appId,
    consumerKeyId: ctx.consumerKeyId,
    requestedTargetName: ir.requestedModel,
    fingerprint,
    now,
  });
  await log({ step: 'sticky_check' });
  let stickyHit = false;
  let sessionStickyHit = false;
  let sorted = [...usableCandidates];
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
      await log({
        step: 'sticky_hit',
        upstreamKeyId: bound.upstreamKeyId,
        upstreamKeyName: bound.upstreamKeyName,
        realModelName: bound.realModelName,
      });
    }
  }

  // 5b. Short-window session stickiness. Only checked when conversation-level
  // sticky did not hit. This gives a weaker (consumerKey + target) binding
  // with a short TTL, reducing cross-channel switching for repeated calls.
  if (!stickyHit) {
    const sessionLookup = await lookupStickySession(ctx.db, {
      consumerKeyId: ctx.consumerKeyId,
      requestedTargetName: ir.requestedModel,
      now,
    });
    await log({ step: 'session_sticky_check' });
    if (sessionLookup.binding && isStickySessionValid(sessionLookup.binding, sorted, { now })) {
      const bound = sorted.find(
        (c) =>
          c.upstreamKeyId === sessionLookup.binding!.upstreamKeyId &&
          c.realModelName === sessionLookup.binding!.realModelName,
      );
      if (bound) {
        sorted = [bound, ...sorted.filter((c) => c !== bound)];
        sessionStickyHit = true;
        void touchStickySession(ctx.db, {
          id: sessionLookup.binding.id,
          ttlMs: sessionLookup.binding.ttlMs,
          now,
        });
        await log({
          step: 'session_sticky_hit',
          upstreamKeyId: bound.upstreamKeyId,
          upstreamKeyName: bound.upstreamKeyName,
          realModelName: bound.realModelName,
        });
      }
    }
  }

  // 6. Walk the candidate list with priority + failover. The first candidate
  // is either the sticky-bound one or the balancer's chosen one.
  const outcome = await tryCandidates(ctx, {
    ir,
    sourceProtocol,
    candidates: sorted,
    traceId,
    log,
    cbSettings,
  });
  const latencyMs = Date.now() - start;
  // The selected candidate is on the success path or on the last-tried error
  // path. We attribute the usage to the *asked-for* target so group-level
  // analytics do not double-count at the public-model level.
  const candidate = outcome.ok ? outcome.candidate : (outcome.lastCandidate ?? sorted[0] ?? null);

  // 6. On a successful routed call, bump the per-period quota counter for the
  // chosen candidate. The counter engine freezes the key when the next call
  // would exceed any configured limit; the freeze takes effect on the next
  // request via the filter. A failure outcome does not count against quota.
  if (candidate) {
    const usage = outcome.ok ? outcome.ir.usage : null;
    const delta = {
      requests: 1,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
    };
    if (outcome.ok) {
      // Bump every configured period for this upstream key so hour/day/week/
      // month caps actually trigger freezes. `recordQuotaUsage` also bumps
      // the running `total` counter for the dashboard. We await the write
      // so the freeze logic on the next request sees a consistent counter;
      // a DB failure is still swallowed and never surfaces to the client.
      try {
        const periods = await getEnabledQuotaPeriods(ctx.db, candidate.upstreamKeyId);
        await recordQuotaUsage(ctx.db, {
          upstreamKeyId: candidate.upstreamKeyId,
          delta,
          periods,
          now,
        });
      } catch {
        /* quota is best-effort */
      }
      // Persist the sticky binding so the next call with the same fingerprint
      // reuses the same candidate. We write a fresh binding (or update the
      // existing one) only on success; failures do not change stickiness.
      // This stays fire-and-forget: a missing or stale binding only causes
      // the next request to pick a fresh candidate, it does not change
      // correctness of the current response.
      void upsertStickyBinding(ctx.db, {
        appId: ctx.appId,
        consumerKeyId: ctx.consumerKeyId,
        requestedTargetName: ir.requestedModel,
        fingerprint,
        upstreamKeyId: candidate.upstreamKeyId,
        realModelName: candidate.realModelName,
        now,
      });
      // Also refresh the short-window session sticky binding for this
      // (consumer key, target) pair. The TTL is taken from the selected
      // upstream key's configuration.
      void getStickySessionTtlMs(ctx.db, candidate.upstreamKeyId).then((ttlMs) => {
        if (ttlMs > 0) {
          return upsertStickySession(ctx.db, {
            consumerKeyId: ctx.consumerKeyId,
            requestedTargetName: ir.requestedModel,
            upstreamKeyId: candidate.upstreamKeyId,
            realModelName: candidate.realModelName,
            ttlMs,
            now,
          });
        }
      });
    }
    // Optional full prompt/response content logging (M6). Only runs on success
    // and only when the administrator has enabled it. Best-effort: storage
    // failures are swallowed.
    if (outcome.ok && candidate) {
      void writeContentLog(ctx.db, {
        requestTraceId: traceId,
        appId: ctx.appId,
        consumerKeyId: ctx.consumerKeyId,
        requestedTargetName: ir.requestedModel,
        resolvedTargetType: target.targetType,
        resolvedTargetId: target.targetId,
        sourceProtocol,
        upstreamKeyId: candidate.upstreamKeyId,
        upstreamKeyName: candidate.upstreamKeyName,
        realModelName: candidate.realModelName,
        prompt: ir.rawRequest,
        response: {
          content: outcome.ir.content,
          model: outcome.ir.model,
          usage: outcome.ir.usage,
        },
        inputTokens: outcome.ir.usage?.inputTokens,
        outputTokens: outcome.ir.usage?.outputTokens,
        totalTokens: outcome.ir.usage?.totalTokens,
        now,
      });
    }

    // Await the usage record so the dashboard reflects the call before the
    // response goes out. Swallow DB errors here too: a failed analytics
    // write must never reach the client.
    try {
      await writeUsageRecord(ctx.db, {
        appId: ctx.appId,
        consumerKeyId: ctx.consumerKeyId,
        requestedTargetName: ir.requestedModel,
        resolvedTargetType: target.targetType,
        resolvedTargetId: target.targetId,
        upstreamKeyId: candidate.upstreamKeyId,
        realModelName: candidate.realModelName,
        sourceProtocol,
        providerType: candidate.providerType,
        stream: false,
        stickyHit,
        sessionStickyHit,
        inputTokens: outcome.ok ? (usage?.inputTokens ?? null) : null,
        outputTokens: outcome.ok ? (usage?.outputTokens ?? null) : null,
        totalTokens: outcome.ok ? (usage?.totalTokens ?? null) : null,
        cacheReadTokens: outcome.ok ? (usage?.cacheReadTokens ?? null) : null,
        cacheWriteTokens: outcome.ok ? (usage?.cacheWriteTokens ?? null) : null,
        status: outcome.ok ? 'success' : 'error',
        errorCode: outcome.ok
          ? null
          : (outcome.providerError.providerCode ?? outcome.providerError.category),
        latencyMs,
      });
    } catch {
      /* usage record is best-effort */
    }
    // Update daily consumption stats (M8). Best-effort.
    try {
      await upsertConsumptionStats(ctx.db, {
        upstreamKeyId: candidate.upstreamKeyId,
        realModelName: candidate.realModelName,
        delta: {
          requestCount: 1,
          successCount: outcome.ok ? 1 : 0,
          errorCount: outcome.ok ? 0 : 1,
          cacheReadTokens: usage?.cacheReadTokens ?? 0,
          cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          totalTokens: usage?.totalTokens ?? 0,
          latencyMs,
        },
        now,
      });
    } catch {
      /* consumption stats are best-effort */
    }
    await log({
      step: 'request_complete',
      finalOutcome: outcome.ok ? 'success' : 'error',
      upstreamKeyId: candidate.upstreamKeyId,
      upstreamKeyName: candidate.upstreamKeyName,
      realModelName: candidate.realModelName,
      latencyMs,
    });
  }
  return outcome;
}

// Touch the upstream key's `lastUsedAt` for the liveness indicator. Best effort.
export async function touchUpstreamLastUsed(db: Db, upstreamKeyId: string): Promise<void> {
  try {
    await db
      .update(upstreamKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(upstreamKeys.id, upstreamKeyId));
  } catch {
    /* ignore */
  }
}

// Re-export the error class checks so route handlers can branch on them.
export {
  isNormalizedError,
  AuthenticationError,
  PermissionError,
  TargetNotFoundError,
  ValidationError,
};
