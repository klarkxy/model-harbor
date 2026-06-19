import { eq, inArray } from 'drizzle-orm';
import {
  type Db,
  type ModelGroupMemberRow,
  type PublicModelCandidateRow,
  type PublicModelRow,
  type UpstreamKeyRow,
  modelGroupMembers,
  publicModelCandidates,
  publicModels,
  upstreamKeys,
} from '../db/index.js';
import {
  protocolFor,
  type ProviderType,
  type SourceProtocol,
  type ProviderCapabilities,
  requiredCapabilities,
  type RequiredCapabilities,
} from '@modelharbor/shared';
import { NoRouteAvailableError, ValidationError } from '@modelharbor/shared';
import { getProviderAdapter } from '../providers/index.js';

// One concrete upstream route the gateway can take: a (upstream key, real
// model) pair. Carries everything the sender needs plus the upstream key's
// current state so the filter function can decide whether the candidate is
// usable right now.
export interface ResolvedCandidate {
  upstreamKeyId: string;
  upstreamKeyName: string;
  providerType: ProviderType;
  baseUrl: string;
  authType: string | null;
  authConfigCiphertext: string | null;
  apiKeyCiphertext: string;
  realModelName: string;
  // Upstream state at expand time. Re-checked by the filter using `now` because
  // a cooldownUntil in the past is no longer a cooldown.
  upstreamEnabled: boolean;
  upstreamFrozen: boolean;
  cooldownUntil: Date | null;
  priority: number;
  weight: number;
  // Source-target info so usage / logs can attribute the candidate back to the
  // public model or group member that surfaced it.
  publicModelId: string;
  publicModelName: string;
  // The candidate row's own enable flag (separate from the public model flag
  // and the upstream key flag). A disabled candidate is never picked even if
  // its upstream key is healthy.
  candidateEnabled: boolean;
  // Whether the public model itself is enabled. Disabled public models are
  // still expanded (so we can keep the schema simple) but their candidates are
  // filtered out below.
  publicModelEnabled: boolean;
  // Endpoint this candidate represents. For upstream keys with multiple
  // endpoints (e.g. MiniMax anthropic + openai), each endpoint becomes its own
  // candidate with its own protocol and baseUrl.
  endpointProtocol: SourceProtocol;
  endpointBaseUrl: string;
  // Optional path override for this endpoint. Mirrors ProviderPresetEndpoint.apiPath.
  endpointApiPath?: string;
  // Raw endpoints JSON from the upstream key, used to expand multi-endpoint keys.
  endpointsJson: string | null;
  // Preset id so the gateway can load provider-specific adapter / transforms.
  providerPresetId: string | null;
  // Extra headers / body params to merge into the upstream request.
  extraHeaders: Record<string, string>;
  extraParams: Record<string, unknown>;
  // Adapter capabilities at expand time. Used by the filter to drop candidates
  // whose upstream does not support features the client request requires.
  capabilities: ProviderCapabilities;
}

interface CandidateRow {
  candidate: PublicModelCandidateRow;
  publicModel: PublicModelRow;
  upstreamKey: UpstreamKeyRow;
}

async function expandPublicModelCandidates(db: Db, publicModelId: string): Promise<CandidateRow[]> {
  return await db
    .select({
      candidate: publicModelCandidates,
      publicModel: publicModels,
      upstreamKey: upstreamKeys,
    })
    .from(publicModelCandidates)
    .innerJoin(publicModels, eq(publicModelCandidates.publicModelId, publicModels.id))
    .innerJoin(upstreamKeys, eq(publicModelCandidates.upstreamKeyId, upstreamKeys.id))
    .where(eq(publicModelCandidates.publicModelId, publicModelId))
    .all();
}

async function expandModelGroupCandidates(db: Db, modelGroupId: string): Promise<CandidateRow[]> {
  const members: Array<{ member: ModelGroupMemberRow; publicModel: PublicModelRow | null }> =
    await db
      .select({ member: modelGroupMembers, publicModel: publicModels })
      .from(modelGroupMembers)
      .leftJoin(publicModels, eq(modelGroupMembers.publicModelId, publicModels.id))
      .where(eq(modelGroupMembers.modelGroupId, modelGroupId))
      .all();

  const publicModelIds = members
    .map((m) => m.publicModel?.id)
    .filter((id): id is string => typeof id === 'string');
  if (publicModelIds.length === 0) return [];

  const rows = await db
    .select({
      candidate: publicModelCandidates,
      publicModel: publicModels,
      upstreamKey: upstreamKeys,
    })
    .from(publicModelCandidates)
    .innerJoin(publicModels, eq(publicModelCandidates.publicModelId, publicModels.id))
    .innerJoin(upstreamKeys, eq(publicModelCandidates.upstreamKeyId, upstreamKeys.id))
    .where(inArray(publicModelCandidates.publicModelId, publicModelIds))
    .all();

  // Only keep candidates that come from an enabled group member pointing at
  // the matching public model. A disabled member (or one whose public model
  // was deleted under it) does not surface its candidates.
  const enabledByPublicId = new Set<string>();
  for (const m of members) {
    if (m.publicModel && m.member.enabled) {
      enabledByPublicId.add(m.publicModel.id);
    }
  }
  return rows.filter((r) => enabledByPublicId.has(r.publicModel.id));
}

function toResolvedCandidate(row: CandidateRow): ResolvedCandidate {
  const adapter = getProviderAdapter({
    providerType: row.upstreamKey.providerType,
    providerPresetId: row.upstreamKey.providerPresetId,
  });
  return {
    upstreamKeyId: row.upstreamKey.id,
    upstreamKeyName: row.upstreamKey.name,
    providerType: row.upstreamKey.providerType,
    baseUrl: row.upstreamKey.baseUrl,
    authType: row.upstreamKey.authType,
    authConfigCiphertext: row.upstreamKey.authConfigCiphertext,
    apiKeyCiphertext: row.upstreamKey.apiKeyCiphertext,
    realModelName: row.candidate.realModelName,
    upstreamEnabled: row.upstreamKey.enabled,
    upstreamFrozen: row.upstreamKey.frozen,
    cooldownUntil: row.upstreamKey.cooldownUntil,
    priority: row.candidate.priority,
    weight: row.candidate.weight,
    publicModelId: row.publicModel.id,
    publicModelName: row.publicModel.name,
    candidateEnabled: row.candidate.enabled,
    publicModelEnabled: row.publicModel.enabled,
    endpointProtocol: protocolFor(row.upstreamKey.providerType),
    endpointBaseUrl: row.upstreamKey.baseUrl,
    endpointsJson: row.upstreamKey.endpointsJson,
    providerPresetId: row.upstreamKey.providerPresetId,
    extraHeaders: parseExtraHeaders(
      row.upstreamKey.extraHeadersJson,
      row.upstreamKey.defaultHeadersJson,
    ),
    extraParams: parseExtraParams(row.upstreamKey.extraParamsJson),
    capabilities: adapter.capabilities,
  };
}

interface UpstreamEndpointJson {
  protocol: SourceProtocol;
  baseUrl: string;
  providerType: ProviderType;
  apiPath?: string;
}

function parseRecordJson(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return null;
}

function toStringRecord(value: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function parseExtraHeaders(
  extraHeadersJson: string | null,
  legacyDefaultHeadersJson: string | null,
): Record<string, string> {
  const extra = parseRecordJson(extraHeadersJson);
  if (extra) return toStringRecord(extra);
  const legacy = parseRecordJson(legacyDefaultHeadersJson);
  return legacy ? toStringRecord(legacy) : {};
}

function parseExtraParams(json: string | null): Record<string, unknown> {
  const parsed = parseRecordJson(json);
  return parsed ?? {};
}

function parseEndpointsJson(json: string | null): UpstreamEndpointJson[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return null;
    const endpoints: UpstreamEndpointJson[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as { protocol?: unknown }).protocol === 'string' &&
        typeof (item as { baseUrl?: unknown }).baseUrl === 'string' &&
        typeof (item as { providerType?: unknown }).providerType === 'string'
      ) {
        endpoints.push(item as UpstreamEndpointJson);
      }
    }
    return endpoints.length > 0 ? endpoints : null;
  } catch {
    return null;
  }
}

// Expand a single upstream-key-level candidate into one or more protocol-level
// candidates. Multi-endpoint keys (e.g. MiniMax) yield one candidate per
// endpoint so the router can match by client protocol. Legacy single-endpoint
// keys yield exactly one candidate with protocol inferred from providerType.
function expandEndpoints(candidate: ResolvedCandidate): ResolvedCandidate[] {
  const endpoints = parseEndpointsJson(candidate.endpointsJson);
  if (!endpoints) {
    return [candidate];
  }
  return endpoints.map((ep) => ({
    ...candidate,
    providerType: ep.providerType,
    endpointProtocol: ep.protocol,
    endpointBaseUrl: ep.baseUrl,
    endpointApiPath: ep.apiPath,
  }));
}

// Public entry point: take a resolved target and return the full list of
// concrete upstream candidates, in declaration order. Filtering happens next.
export async function expandCandidates(
  db: Db,
  args: { targetType: 'public_model' | 'model_group'; targetId: string },
): Promise<ResolvedCandidate[]> {
  if (args.targetType === 'public_model') {
    const rows = await expandPublicModelCandidates(db, args.targetId);
    if (rows.length === 0) {
      throw new ValidationError('public model has no candidates');
    }
    return rows.flatMap(toResolvedCandidate).flatMap(expandEndpoints);
  }
  const rows = await expandModelGroupCandidates(db, args.targetId);
  if (rows.length === 0) {
    throw new NoRouteAvailableError('model group has no candidates');
  }
  return rows.flatMap(toResolvedCandidate).flatMap(expandEndpoints);
}

// Why a candidate was dropped. Used in error messages, logs, and tests.
export type FilterReason =
  | 'candidate_disabled'
  | 'public_model_disabled'
  | 'upstream_disabled'
  | 'upstream_frozen'
  | 'upstream_cooldown'
  | 'protocol_mismatch'
  | 'upstream_over_quota'
  | 'capability_mismatch';

export interface FilterResult {
  accepted: ResolvedCandidate[];
  dropped: Array<{ candidate: ResolvedCandidate; reason: FilterReason }>;
  // Candidates that passed all non-protocol filters but speak a different
  // protocol than the client. The gateway may use them as a cross-protocol
  // fallback when no same-protocol candidate exists.
  fallback: ResolvedCandidate[];
}

// Check whether a candidate's adapter supports the features required by the
// request. Returns the first mismatched capability, or null if all are fine.
function checkCapabilityMismatch(
  candidate: ResolvedCandidate,
  required: RequiredCapabilities,
): FilterReason | null {
  if (required.streaming && !candidate.capabilities.supportsStreaming) {
    return 'capability_mismatch';
  }
  if (required.tools && !candidate.capabilities.supportsTools) {
    return 'capability_mismatch';
  }
  if (required.toolChoice && !candidate.capabilities.supportsToolChoice) {
    return 'capability_mismatch';
  }
  if (required.vision && !candidate.capabilities.supportsVision) {
    return 'capability_mismatch';
  }
  if (required.jsonMode && !candidate.capabilities.supportsJsonMode) {
    return 'capability_mismatch';
  }
  if (required.thinking && !candidate.capabilities.supportsThinking) {
    return 'capability_mismatch';
  }
  return null;
}

// Filter the candidate list for a specific request. Applies all non-protocol
// filters first, then splits the survivors into:
//   - `accepted`: candidates whose endpoint protocol matches the client protocol
//   - `fallback`: candidates that survived filtering but speak a different
//     protocol (used for cross-protocol conversion when no same-protocol
//     candidate is available)
//   - `dropped`: candidates removed by a filter, with the reason
export function filterCandidates(
  candidates: ResolvedCandidate[],
  args: {
    sourceProtocol: SourceProtocol;
    now: Date;
    quotaExceeded?: ReadonlySet<string>;
    rawRequest?: unknown;
  },
): FilterResult {
  const required = requiredCapabilities(args.rawRequest);
  const accepted: ResolvedCandidate[] = [];
  const fallback: ResolvedCandidate[] = [];
  const dropped: Array<{ candidate: ResolvedCandidate; reason: FilterReason }> = [];
  const nowMs = args.now.getTime();
  for (const c of candidates) {
    if (!c.candidateEnabled) {
      dropped.push({ candidate: c, reason: 'candidate_disabled' });
      continue;
    }
    if (!c.publicModelEnabled) {
      dropped.push({ candidate: c, reason: 'public_model_disabled' });
      continue;
    }
    if (!c.upstreamEnabled) {
      dropped.push({ candidate: c, reason: 'upstream_disabled' });
      continue;
    }
    if (c.upstreamFrozen) {
      dropped.push({ candidate: c, reason: 'upstream_frozen' });
      continue;
    }
    if (c.cooldownUntil instanceof Date && c.cooldownUntil.getTime() > nowMs) {
      dropped.push({ candidate: c, reason: 'upstream_cooldown' });
      continue;
    }
    if (args.quotaExceeded && args.quotaExceeded.has(c.upstreamKeyId)) {
      dropped.push({ candidate: c, reason: 'upstream_over_quota' });
      continue;
    }
    const mismatch = checkCapabilityMismatch(c, required);
    if (mismatch) {
      dropped.push({ candidate: c, reason: mismatch });
      continue;
    }
    if (c.endpointProtocol !== args.sourceProtocol) {
      // Cross-protocol candidates are kept as fallback; they are only used
      // when no same-protocol candidate is available.
      fallback.push(c);
      continue;
    }
    accepted.push(c);
  }
  return { accepted, dropped, fallback };
}
