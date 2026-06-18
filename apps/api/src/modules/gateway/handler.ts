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
import { type Db, upstreamKeys } from '../db/index.js';
import { decryptSecret } from '../auth/crypto.js';
import {
  type ResolvedCandidate,
  expandCandidates,
  filterCandidates,
} from '../router/candidates.js';
import { assertConsumerKeyAccess } from '../router/access.js';
import { resolveTargetByName } from '../router/resolve.js';
import {
  type NormalizedProviderError,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type ProviderRequestContext,
  type ProviderAdapter,
  anthropicRequestToIR,
  openaiRequestToIR,
  getAdapter,
} from '../providers/index.js';
import { sendUpstreamRequest, type SendOutcome } from './sender.js';
import { writeUsageRecord } from '../usage/index.js';
import { applyCooldown, computeCooldownUpdate, shouldCooldown } from './cooldown.js';
import {
  conversationFingerprint,
  isStickyBindingValid,
  lookupStickyBinding,
  touchStickyBinding,
  upsertStickyBinding,
} from '../sticky/index.js';
import { getEnabledQuotaPeriods, recordQuotaUsage, wouldExceedQuota } from '../quota/index.js';

export interface GatewayRequestContext {
  db: Db;
  secretKey: string;
  consumerKeyId: string;
  appId: string;
  timeoutMs?: number;
  defaultUpstreamTimeoutMs?: number;
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
  },
): Promise<GatewayOutcome> {
  let lastError: NormalizedProviderError | null = null;
  let lastCandidate: ResolvedCandidate | null = null;
  let attempts = 0;

  for (const candidate of args.candidates) {
    lastCandidate = candidate;
    attempts += 1;
    const adapter = getAdapter(candidate.providerType);
    const request = buildHttpRequest(ctx, { ir: args.ir, candidate, adapter });
    console.error(
      `[modelharbor upstream] candidate provider=${candidate.providerType} model=${candidate.realModelName} upstreamKeyId=${candidate.upstreamKeyId} baseUrl=${request.url}`,
    );
    const outcome = await sendUpstreamRequest(request, {
      timeoutMs: ctx.defaultUpstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
    });

    const classified = classifyOutcome(adapter, { outcome, request, ir: args.ir });
    if (classified.kind === 'error') {
      console.error(
        `[modelharbor upstream] classified error: ${classified.error.category} providerCode=${classified.error.providerCode} message=${classified.error.providerMessage}`,
      );
    }
    if (classified.kind === 'success') {
      return {
        ok: true,
        ir: classified.response,
        candidate,
        adapterType: candidate.providerType,
        providerResponse: classified.raw,
      };
    }
    lastError = classified.error;

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

function buildHttpRequest(
  ctx: GatewayRequestContext,
  args: { ir: ChatRequestIR; candidate: ResolvedCandidate; adapter: ProviderAdapter },
): ProviderHttpRequest {
  const apiKey = decryptSecret(args.candidate.apiKeyCiphertext, ctx.secretKey);
  const providerCtx: ProviderRequestContext = {
    ir: args.ir,
    realModelName: args.candidate.realModelName,
    upstreamKeyId: args.candidate.upstreamKeyId,
    timeoutMs: ctx.defaultUpstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
    stream: args.ir.stream,
    baseUrl: args.candidate.endpointBaseUrl,
    apiPath: args.candidate.endpointApiPath,
    apiKey,
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
      stream: request.method === 'POST' ? false : false,
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

async function runGateway(
  ir: ChatRequestIR,
  sourceProtocol: SourceProtocol,
  ctx: GatewayRequestContext,
): Promise<GatewayOutcome> {
  const start = Date.now();
  const now = new Date();

  // 1. Resolve target name to (type, id). Throws TargetNotFoundError on miss.
  const target = await resolveTargetByName(ctx.db, ir.requestedModel);

  // 2. Make sure the consumer key is allowed to call this target.
  await assertConsumerKeyAccess(ctx.db, {
    consumerKeyId: ctx.consumerKeyId,
    targetType: target.targetType,
    targetId: target.targetId,
  });

  // 3. Expand + filter candidates. The router computes the set of upstream
  // keys that are currently over quota (M6) and passes it to the filter.
  const all = await expandCandidates(ctx.db, {
    targetType: target.targetType,
    targetId: target.targetId,
  });
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
  const { accepted, fallback } = filterCandidates(all, { sourceProtocol, now, quotaExceeded });
  const usableCandidates = accepted.length > 0 ? accepted : fallback;
  if (usableCandidates.length === 0) {
    throw new NoRouteAvailableError('no available upstream for target');
  }

  // 4. Sticky binding lookup. If a fresh binding exists and the bound
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
  let stickyHit = false;
  let sorted = [...usableCandidates].sort((a, b) => a.priority - b.priority);
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

  // 5. Walk the candidate list with priority + failover. The first candidate
  // is either the sticky-bound one or the lowest-priority one.
  const outcome = await tryCandidates(ctx, { ir, sourceProtocol, candidates: sorted });
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
        inputTokens: outcome.ok ? (usage?.inputTokens ?? null) : null,
        outputTokens: outcome.ok ? (usage?.outputTokens ?? null) : null,
        totalTokens: outcome.ok ? (usage?.totalTokens ?? null) : null,
        status: outcome.ok ? 'success' : 'error',
        errorCode: outcome.ok
          ? null
          : (outcome.providerError.providerCode ?? outcome.providerError.category),
        latencyMs,
      });
    } catch {
      /* usage record is best-effort */
    }
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
