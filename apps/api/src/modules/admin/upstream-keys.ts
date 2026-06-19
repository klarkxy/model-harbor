import { eq, desc, and, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  generateId,
  ValidationError,
  type ProviderType,
  type ChatRequestIR,
} from '@modelharbor/shared';
import {
  type UpstreamKeyCounterRow,
  type UpstreamKeyQuotaRow,
  type UpstreamKeyQuotaInsert,
  type UpstreamKeyRow,
  type Db,
  publicModelCandidates,
  upstreamKeyCounters,
  upstreamKeyQuotas,
  upstreamKeys,
} from '../db/index.js';
import { resetExpiredCounters } from '../quota/index.js';
import { listStickyBindingsForConsumer, pruneExpiredStickyBindings } from '../sticky/index.js';
import { recordAuditEvent, type AuditAction } from '../observability/index.js';
import {
  getModelMappings,
  getProviderPreset,
  listProviderPresets,
  type ProviderPreset,
  type ProviderPresetEndpoint,
} from '../providers/presets.js';
import { buildOpenAICompatibleRequest } from '../providers/openai-compatible.js';
import { buildAnthropicCompatibleRequest } from '../providers/anthropic-compatible.js';
import { sendUpstreamRequest } from '../gateway/sender.js';
import {
  assertAuthType,
  resolveAuthorizationHeader,
  resolveAuthorizationHeaderFromCredentials,
  validateAuthConfig,
  type UpstreamAuthType,
} from '../providers/auth/index.js';
import { encryptSecret } from '../auth/crypto.js';
import {
  getUpstreamKeyCandidates,
  onboardUpstreamKeyWithMappings,
  syncUpstreamKeyMappings,
  type OnboardingMapping,
  type UpstreamKeyCandidateMapping,
} from './upstream-onboarding.js';
import {
  assertProviderType,
  assertQuotaPeriod,
  assertPositiveInt,
  assertSourceProtocol,
  decryptUpstreamApiKey,
  encryptUpstreamApiKey,
  parseJsonArray,
  parseJsonObject,
  parseJsonRecord,
  safeJsonString,
} from './helpers.js';

function extractAuthConfig(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return parseJsonRecord(typeof value === 'string' ? value : null) ?? {};
}

export interface AuditMeta {
  actorAdminId: string | null;
  actorUsername: string | null;
  ip: string | null;
}

export function auditMetaFromRequest(req: FastifyRequest): AuditMeta {
  const admin = (req as unknown as { admin?: { id: string; username: string } | null }).admin;
  return {
    actorAdminId: admin?.id ?? null,
    actorUsername: admin?.username ?? null,
    ip: req.ip ?? null,
  };
}

async function audit(
  db: Db,
  meta: AuditMeta,
  action: AuditAction,
  resourceId: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  await recordAuditEvent(db, {
    actorAdminId: meta.actorAdminId,
    actorUsername: meta.actorUsername,
    action,
    resourceType: 'upstream_key',
    resourceId,
    details,
    ip: meta.ip,
  });
}

export interface UpstreamKeyRouteDeps {
  db: Db;
  secretKey: string;
}

interface CreateUpstreamKeyBody {
  name?: unknown;
  providerType?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  authType?: unknown;
  authConfig?: unknown;
  defaultHeaders?: unknown;
  extraHeaders?: unknown;
  extraParams?: unknown;
  supportedModels?: unknown;
  providerPresetId?: unknown;
  endpoints?: unknown;
  modelMappings?: unknown;
  quota?: {
    period?: unknown;
    requestLimit?: unknown;
    inputTokenLimit?: unknown;
    outputTokenLimit?: unknown;
    totalTokenLimit?: unknown;
  };
}

function presentUpstreamKey(
  row: UpstreamKeyRow,
  quota: UpstreamKeyQuotaRow | null,
  counters: UpstreamKeyCounterRow[],
  candidateCount = 0,
) {
  return {
    id: row.id,
    name: row.name,
    providerType: row.providerType,
    baseUrl: row.baseUrl,
    authType: row.authType,
    apiKeyPrefix: row.apiKeyPrefix,
    defaultHeaders: parseJsonObject(row.defaultHeadersJson),
    extraHeaders: parseJsonObject(row.extraHeadersJson),
    extraParams: parseJsonRecord(row.extraParamsJson) ?? {},
    supportedModels: parseJsonArray(row.supportedModelsJson),
    candidateCount,
    endpoints: row.endpointsJson ? parseEndpoints(row.endpointsJson) : [],
    providerPresetId: row.providerPresetId,
    enabled: row.enabled,
    frozen: row.frozen,
    frozenReason: row.frozenReason,
    cooldownUntil: row.cooldownUntil,
    lastHealthStatus: row.lastHealthStatus,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    quota: quota
      ? {
          period: quota.period,
          requestLimit: quota.requestLimit,
          inputTokenLimit: quota.inputTokenLimit,
          outputTokenLimit: quota.outputTokenLimit,
          totalTokenLimit: quota.totalTokenLimit,
          enabled: quota.enabled,
        }
      : null,
    counters: counters.map((c) => presentCounter(c)),
  };
}

function normalizeEndpoints(value: unknown): ProviderPresetEndpoint[] {
  if (!Array.isArray(value)) return [];
  const endpoints: ProviderPresetEndpoint[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      throw new ValidationError('each endpoint must be an object');
    }
    const protocol = (item as { protocol?: unknown }).protocol;
    const baseUrl = (item as { baseUrl?: unknown }).baseUrl;
    const providerType = (item as { providerType?: unknown }).providerType;
    const apiPath = (item as { apiPath?: unknown }).apiPath;
    if (
      typeof protocol !== 'string' ||
      typeof baseUrl !== 'string' ||
      typeof providerType !== 'string'
    ) {
      throw new ValidationError('endpoint requires protocol, baseUrl, and providerType');
    }
    assertSourceProtocol(protocol);
    assertProviderType(providerType);
    const endpoint: ProviderPresetEndpoint = { protocol, baseUrl, providerType };
    if (typeof apiPath === 'string' && apiPath.length > 0) {
      endpoint.apiPath = apiPath;
    }
    endpoints.push(endpoint);
  }
  return endpoints;
}

function normalizeExtraHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function normalizeExtraParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function normalizeModelMappings(value: unknown): OnboardingMapping[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('modelMappings must be an array');
  }
  if (value.length === 0) {
    throw new ValidationError('modelMappings must contain at least one mapping');
  }
  const mappings: OnboardingMapping[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      throw new ValidationError('each modelMapping must be an object');
    }
    const realName =
      typeof (item as { realName?: unknown }).realName === 'string'
        ? (item as { realName: string }).realName.trim()
        : '';
    if (!realName) {
      throw new ValidationError('modelMapping realName is required');
    }
    if (seen.has(realName)) {
      throw new ValidationError(`duplicate modelMapping realName: ${realName}`);
    }
    seen.add(realName);
    const publicNameRaw = (item as { publicName?: unknown }).publicName;
    const publicName = typeof publicNameRaw === 'string' ? publicNameRaw.trim() : '';
    const enabledRaw = (item as { enabled?: unknown }).enabled;
    const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : true;
    mappings.push({ publicName: publicName || realName, realName, enabled });
  }
  return mappings;
}

function parseEndpoints(json: string | null): ProviderPresetEndpoint[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const endpoints: ProviderPresetEndpoint[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const protocol = (item as { protocol?: unknown }).protocol;
      const baseUrl = (item as { baseUrl?: unknown }).baseUrl;
      const providerType = (item as { providerType?: unknown }).providerType;
      const apiPath = (item as { apiPath?: unknown }).apiPath;
      if (
        typeof protocol === 'string' &&
        typeof baseUrl === 'string' &&
        typeof providerType === 'string'
      ) {
        assertSourceProtocol(protocol);
        assertProviderType(providerType);
        const endpoint: ProviderPresetEndpoint = { protocol, baseUrl, providerType };
        if (typeof apiPath === 'string' && apiPath.length > 0) {
          endpoint.apiPath = apiPath;
        }
        endpoints.push(endpoint);
      }
    }
    return endpoints;
  } catch {
    return [];
  }
}

function presentCounter(c: UpstreamKeyCounterRow) {
  return {
    id: c.id,
    period: c.period,
    periodStartedAt: c.periodStartedAt,
    periodEndsAt: c.periodEndsAt,
    requestCount: c.requestCount,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
    totalTokens: c.totalTokens,
  };
}

function buildModelsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/v1')) {
    return `${normalized}/models`;
  }
  return `${normalized}/v1/models`;
}

function extractModelIds(json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const candidates: unknown[] = [];
  if ('data' in json && Array.isArray((json as { data?: unknown }).data)) {
    candidates.push(...(json as { data: unknown[] }).data);
  }
  if ('models' in json && Array.isArray((json as { models?: unknown }).models)) {
    candidates.push(...(json as { models: unknown[] }).models);
  }
  if (Array.isArray(json)) {
    candidates.push(...json);
  }
  const ids: string[] = [];
  for (const item of candidates) {
    if (typeof item === 'string' && item.length > 0) {
      ids.push(item);
    } else if (item && typeof item === 'object') {
      const id = (item as { id?: unknown }).id;
      if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }
  return ids;
}

function buildCozeBotsUrl(baseUrl: string, workspaceId: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  const url = new URL('/v1/bots', normalized);
  url.searchParams.set('workspace_id', workspaceId);
  // Coze requires publish_status when connector_id is provided.
  // published_online is the default when omitted, but must be explicit here.
  url.searchParams.set('publish_status', 'published_online');
  url.searchParams.set('connector_id', '1024');
  url.searchParams.set('page_num', '1');
  url.searchParams.set('page_size', '50');
  return url.toString();
}

interface CozeBotItem {
  id: string;
  name: string;
}

function extractCozeBots(json: unknown): CozeBotItem[] {
  if (!json || typeof json !== 'object') return [];
  const items: unknown[] = [];
  const data = (json as { data?: unknown }).data;
  if (
    data &&
    typeof data === 'object' &&
    'items' in data &&
    Array.isArray((data as { items?: unknown[] }).items)
  ) {
    items.push(...(data as { items: unknown[] }).items);
  }
  const out: CozeBotItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown }).id;
    const name = (item as { name?: unknown }).name;
    if (typeof id === 'string' && id.length > 0 && typeof name === 'string') {
      out.push({ id, name });
    }
  }
  return out;
}

export interface DiscoverModelsBody {
  baseUrl?: unknown;
  apiKey?: unknown;
  providerType?: unknown;
  providerPresetId?: unknown;
  upstreamKeyId?: unknown;
  // Coze requires a workspace_id to list bots via /v1/bots.
  workspaceId?: unknown;
  authType?: unknown;
  authConfig?: unknown;
}

interface PingUpstreamKeyBody {
  realModelName?: unknown;
}

function sourceProtocolFor(providerType: ProviderType): 'openai' | 'anthropic' {
  return providerType === 'anthropic_compatible' ? 'anthropic' : 'openai';
}

function buildPingRequest(
  providerType: ProviderType,
  baseUrl: string,
  apiPath: string | undefined,
  apiKey: string,
  extraHeaders: Record<string, string>,
  extraParams: Record<string, unknown>,
  realModelName: string,
): ReturnType<typeof buildOpenAICompatibleRequest> {
  const ir: ChatRequestIR = {
    sourceProtocol: sourceProtocolFor(providerType),
    requestedModel: realModelName,
    system: null,
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 1,
    temperature: null,
    topP: null,
    stream: false,
    metadata: {},
    rawRequest: null,
  };
  const ctx = {
    ir,
    realModelName,
    upstreamKeyId: 'ping',
    timeoutMs: 10_000,
    stream: false,
    baseUrl,
    apiPath,
    apiKey,
    extraHeaders,
    extraParams,
  };
  if (providerType === 'anthropic_compatible') {
    return buildAnthropicCompatibleRequest(ctx);
  }
  return buildOpenAICompatibleRequest(ctx);
}

async function pingUpstreamModel(
  row: UpstreamKeyRow,
  realModelName: string,
  secretKey: string,
  db: Db,
): Promise<{
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: { type: string; message: string };
}> {
  const endpoints = row.endpointsJson ? parseEndpoints(row.endpointsJson) : [];
  const endpoint = endpoints[0];
  const providerType = endpoint?.providerType ?? row.providerType;
  const baseUrl = endpoint?.baseUrl ?? row.baseUrl;
  const apiPath = endpoint?.apiPath;
  const authHeader = await resolveAuthorizationHeader({ row, secretKey, baseUrl, db });
  const apiKey = authHeader.replace(/^Bearer\s+/i, '');
  const extraHeaders = parseJsonObject(row.extraHeadersJson);
  const extraParams = parseJsonRecord(row.extraParamsJson) ?? {};

  const req = buildPingRequest(
    providerType,
    baseUrl,
    apiPath,
    apiKey,
    extraHeaders,
    extraParams,
    realModelName,
  );
  const start = performance.now();
  const outcome = await sendUpstreamRequest(req, { timeoutMs: 10_000 });

  if (outcome.response) {
    const latencyMs = outcome.response.ttfbMs;
    if (outcome.response.status >= 200 && outcome.response.status < 300) {
      return { ok: true, status: outcome.response.status, latencyMs };
    }
    return {
      ok: false,
      status: outcome.response.status,
      latencyMs,
      error: {
        type: 'upstream_error',
        message: `upstream returned ${outcome.response.status}`,
      },
    };
  }

  const transportError = outcome.transportError!;
  return {
    ok: false,
    latencyMs: Math.round(performance.now() - start),
    error: {
      type: transportError.name,
      message: transportError.message,
    },
  };
}

function resolveDiscoveryEndpoint(
  preset: ProviderPreset | undefined,
  fallbackBaseUrl: string,
  fallbackProviderType: ProviderType,
): { baseUrl: string; providerType: ProviderType } {
  if (!preset || preset.endpoints.length === 0) {
    return { baseUrl: fallbackBaseUrl, providerType: fallbackProviderType };
  }
  // Most providers expose /v1/models through their OpenAI-compatible endpoint.
  const openaiEndpoint = preset.endpoints.find((e) => e.providerType === 'openai_compatible');
  const endpoint = openaiEndpoint ?? preset.endpoints[0];
  return { baseUrl: endpoint!.baseUrl, providerType: endpoint!.providerType };
}

// Some providers (e.g. SiliconFlow) return model IDs with vendor prefixes such
// as "vendor/model-name". For those presets we expose only the actual model
// name as the public name so consumers don't have to type the prefix.
function derivePublicName(presetId: string | undefined, realName: string): string {
  if (presetId === 'siliconflow') {
    const lastSlash = realName.lastIndexOf('/');
    if (lastSlash >= 0) {
      return realName.slice(lastSlash + 1);
    }
  }
  return realName;
}

export interface DiscoverContext {
  body: DiscoverModelsBody;
  db: Db;
  secretKey: string;
}

export async function discoverUpstreamModels(
  ctx: DiscoverContext,
): Promise<Array<{ realName: string; publicName: string }>> {
  const { body, db, secretKey } = ctx;
  const fallbackBaseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const rawProviderType = typeof body.providerType === 'string' ? body.providerType : '';
  const upstreamKeyId = typeof body.upstreamKeyId === 'string' ? body.upstreamKeyId : '';

  assertProviderType(rawProviderType);

  const presetId = typeof body.providerPresetId === 'string' ? body.providerPresetId : '';
  const preset = presetId ? getProviderPreset(presetId) : undefined;
  const { baseUrl, providerType } = resolveDiscoveryEndpoint(
    preset,
    fallbackBaseUrl,
    rawProviderType as ProviderType,
  );
  if (!baseUrl) throw new ValidationError('baseUrl is required');

  let upstreamKey: UpstreamKeyRow | undefined;
  if (upstreamKeyId) {
    upstreamKey = await db
      .select()
      .from(upstreamKeys)
      .where(eq(upstreamKeys.id, upstreamKeyId))
      .get();
    if (!upstreamKey) {
      throw new ValidationError('upstream key not found');
    }
  }

  let authHeader: string;
  if (upstreamKey) {
    authHeader = await resolveAuthorizationHeader({ row: upstreamKey, secretKey, baseUrl, db });
  } else {
    const rawAuthType = body.authType;
    const authType: UpstreamAuthType =
      typeof rawAuthType === 'string' ? assertAuthType(rawAuthType) : 'pat';
    if (authType === 'pat') {
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
      if (!apiKey) throw new ValidationError('apiKey is required');
      authHeader = `Bearer ${apiKey}`;
    } else {
      const authConfig = extractAuthConfig(body.authConfig);
      authHeader = await resolveAuthorizationHeaderFromCredentials(baseUrl, secretKey, {
        authType,
        authConfig,
      });
    }
  }

  const extraHeaders: Record<string, string> = {
    ...parseJsonObject(
      preset?.defaultExtraHeaders ? JSON.stringify(preset.defaultExtraHeaders) : null,
    ),
    ...parseJsonObject(upstreamKey?.extraHeadersJson ?? null),
  };

  const headers: Record<string, string> = {
    accept: 'application/json',
    ...extraHeaders,
  };
  if (providerType === 'anthropic_compatible') {
    headers['x-api-key'] = authHeader.replace(/^Bearer\s+/i, '');
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.authorization = authHeader;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    if (providerType === 'coze') {
      const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '';
      if (!workspaceId) {
        throw new ValidationError('workspaceId is required for Coze discovery');
      }
      const botsUrl = buildCozeBotsUrl(baseUrl, workspaceId);
      console.error(
        `[modelharbor upstream] discover bots --> GET ${botsUrl} (providerType=coze, keySource=${upstreamKeyId ? 'stored' : 'payload'})`,
      );
      const res = await fetch(botsUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      const bodyText = await res.text();
      const bodyPreview = bodyText.slice(0, 500);
      console.error(
        `[modelharbor upstream] discover bots <-- ${res.status} ${botsUrl} body=${bodyPreview}`,
      );
      if (!res.ok) {
        throw new Error(
          `upstream returned ${res.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`,
        );
      }
      let json: unknown;
      try {
        json = JSON.parse(bodyText);
      } catch {
        throw new Error('upstream returned invalid JSON');
      }
      const bots = extractCozeBots(json);

      const realToPublic = new Map<string, string>();
      if (preset) {
        for (const mapping of getModelMappings(preset)) {
          realToPublic.set(mapping.realName, mapping.publicName);
        }
      }

      return bots.map((bot) => ({
        realName: bot.id,
        publicName: realToPublic.get(bot.id) ?? bot.name,
      }));
    }

    const modelsUrl = buildModelsUrl(baseUrl);
    console.error(
      `[modelharbor upstream] discover models --> GET ${modelsUrl} (providerType=${providerType}, keySource=${upstreamKeyId ? 'stored' : 'payload'})`,
    );
    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    const bodyText = await res.text();
    const bodyPreview = bodyText.slice(0, 500);
    console.error(
      `[modelharbor upstream] discover models <-- ${res.status} ${modelsUrl} body=${bodyPreview}`,
    );
    if (!res.ok) {
      throw new Error(
        `upstream returned ${res.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`,
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error('upstream returned invalid JSON');
    }
    const ids = extractModelIds(json);

    const realToPublic = new Map<string, string>();
    if (preset) {
      for (const mapping of getModelMappings(preset)) {
        realToPublic.set(mapping.realName, mapping.publicName);
      }
    }

    return ids.map((realName) => ({
      realName,
      publicName: realToPublic.get(realName) ?? derivePublicName(preset?.id, realName),
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[modelharbor upstream] discover models <-- transport/error ${buildModelsUrl(baseUrl)}`,
      { message },
    );
    throw new Error(`failed to fetch models: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

export function registerUpstreamKeyRoutes(app: FastifyInstance, deps: UpstreamKeyRouteDeps): void {
  const { db, secretKey } = deps;

  app.get('/api/admin/upstream-keys', async () => {
    const rows = await db.select().from(upstreamKeys).orderBy(desc(upstreamKeys.createdAt)).all();
    const quotas = await db.select().from(upstreamKeyQuotas).all();
    const byId = new Map(quotas.map((q) => [q.upstreamKeyId, q]));
    const counters = await db.select().from(upstreamKeyCounters).all();
    const countersByKey = new Map<string, UpstreamKeyCounterRow[]>();
    for (const c of counters) {
      const arr = countersByKey.get(c.upstreamKeyId) ?? [];
      arr.push(c);
      countersByKey.set(c.upstreamKeyId, arr);
    }
    const candidates = await db
      .select({ upstreamKeyId: publicModelCandidates.upstreamKeyId })
      .from(publicModelCandidates)
      .all();
    const candidateCounts = new Map<string, number>();
    for (const c of candidates) {
      candidateCounts.set(c.upstreamKeyId, (candidateCounts.get(c.upstreamKeyId) ?? 0) + 1);
    }
    return {
      items: rows.map((r) =>
        presentUpstreamKey(
          r,
          byId.get(r.id) ?? null,
          countersByKey.get(r.id) ?? [],
          candidateCounts.get(r.id) ?? 0,
        ),
      ),
    };
  });

  app.get('/api/admin/upstream-keys/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    if (!row) {
      reply.code(404).send({
        error: {
          message: 'upstream key not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }
    const quota =
      (await db
        .select()
        .from(upstreamKeyQuotas)
        .where(eq(upstreamKeyQuotas.upstreamKeyId, id))
        .get()) ?? null;
    return presentUpstreamKey(row, quota, []);
  });

  app.post('/api/admin/upstream-keys', async (req, reply) => {
    const body = (req.body ?? {}) as CreateUpstreamKeyBody;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
    const supportedModels = Array.isArray(body.supportedModels)
      ? body.supportedModels.filter((x): x is string => typeof x === 'string')
      : [];
    if (!name) throw new ValidationError('name is required');

    // Resolve provider preset or explicit endpoints.
    const presetId = typeof body.providerPresetId === 'string' ? body.providerPresetId : '';
    const preset = presetId ? getProviderPreset(presetId) : undefined;
    if (presetId && !preset) {
      throw new ValidationError(`unknown provider preset: ${presetId}`);
    }

    let endpoints: ProviderPresetEndpoint[] = [];
    if (preset) {
      endpoints = preset.endpoints;
    } else if (body.endpoints !== undefined) {
      endpoints = normalizeEndpoints(body.endpoints);
      if (endpoints.length === 0) {
        throw new ValidationError('endpoints must contain at least one endpoint');
      }
    }

    // Legacy single-endpoint mode still requires providerType + baseUrl.
    let providerType: ProviderType = 'anthropic_compatible';
    let baseUrl = '';
    if (endpoints.length > 0) {
      providerType = endpoints[0]!.providerType;
      baseUrl = endpoints[0]!.baseUrl;
    } else {
      const rawProviderType = typeof body.providerType === 'string' ? body.providerType : '';
      const rawBaseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
      if (!rawBaseUrl) throw new ValidationError('baseUrl is required');
      assertProviderType(rawProviderType);
      providerType = rawProviderType;
      baseUrl = rawBaseUrl;
    }

    // Resolve authentication strategy. Presets may declare a default strategy
    // (e.g. Coze defaults to OAuth JWT); otherwise fall back to PAT.
    const rawAuthType = body.authType;
    const authType: UpstreamAuthType =
      typeof rawAuthType === 'string'
        ? assertAuthType(rawAuthType)
        : preset?.authStrategies?.default
          ? assertAuthType(preset.authStrategies.default)
          : 'pat';

    let apiKeyCiphertext = '';
    let apiKeyPrefix = '';
    let authConfigCiphertext: string | null = null;
    if (authType === 'pat') {
      if (!apiKey) throw new ValidationError('apiKey is required');
      const enc = encryptUpstreamApiKey(apiKey, secretKey);
      apiKeyCiphertext = enc.ciphertext;
      apiKeyPrefix = enc.prefix;
    } else {
      const rawAuthConfig = extractAuthConfig(body.authConfig);
      const validated = validateAuthConfig(authType, rawAuthConfig);
      authConfigCiphertext = encryptSecret(JSON.stringify(validated), secretKey).ciphertext;
    }

    // Resolve model mappings. Preset defaults are used unless the admin supplied
    // a custom list in the UI.
    let modelMappings: OnboardingMapping[] | undefined;
    if (body.modelMappings !== undefined) {
      modelMappings = normalizeModelMappings(body.modelMappings);
    } else if (preset) {
      modelMappings = getModelMappings(preset).map((m) => ({ ...m, enabled: true }));
    }

    const existing = await db.select().from(upstreamKeys).where(eq(upstreamKeys.name, name)).get();
    if (existing) {
      reply.code(409).send({
        error: {
          message: 'upstream key name already in use',
          type: 'validation_error',
          code: 'validation_error',
        },
      });
      return;
    }

    const id = generateId('upstreamKey');
    const now = new Date();

    const extraHeaders =
      body.extraHeaders !== undefined
        ? normalizeExtraHeaders(body.extraHeaders)
        : (preset?.defaultExtraHeaders ?? {});
    const extraParams =
      body.extraParams !== undefined
        ? normalizeExtraParams(body.extraParams)
        : (preset?.defaultExtraParams ?? {});

    await db.insert(upstreamKeys).values({
      id,
      name,
      providerType,
      baseUrl,
      authType,
      apiKeyCiphertext,
      apiKeyPrefix,
      authConfigCiphertext,
      defaultHeadersJson: safeJsonString(body.defaultHeaders, '{}'),
      extraHeadersJson: safeJsonString(extraHeaders, '{}'),
      extraParamsJson: safeJsonString(extraParams, '{}'),
      supportedModelsJson: JSON.stringify(supportedModels),
      endpointsJson: endpoints.length > 0 ? JSON.stringify(endpoints) : null,
      providerPresetId: preset ? preset.id : null,
      enabled: true,
      frozen: false,
      createdAt: now,
      updatedAt: now,
    });

    if (modelMappings && modelMappings.length > 0) {
      try {
        await onboardUpstreamKeyWithMappings(db, id, modelMappings);
      } catch (err) {
        // Onboarding failure should not block the upstream key creation, but
        // we record the error in the response so the admin knows.
        reply.header(
          'x-onboarding-warning',
          err instanceof Error ? err.message : 'onboarding failed',
        );
      }
    }

    if (body.quota) {
      const period = typeof body.quota.period === 'string' ? body.quota.period : '';
      assertQuotaPeriod(period);
      const q: UpstreamKeyQuotaInsert = {
        id: generateId('upstreamKey') + '_q',
        upstreamKeyId: id,
        period,
        requestLimit: assertPositiveInt('requestLimit', body.quota.requestLimit),
        inputTokenLimit: assertPositiveInt('inputTokenLimit', body.quota.inputTokenLimit),
        outputTokenLimit: assertPositiveInt('outputTokenLimit', body.quota.outputTokenLimit),
        totalTokenLimit: assertPositiveInt('totalTokenLimit', body.quota.totalTokenLimit),
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(upstreamKeyQuotas).values(q);
    }

    const row = await db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    if (!row) throw new Error('insert failed');
    const quota =
      (await db
        .select()
        .from(upstreamKeyQuotas)
        .where(eq(upstreamKeyQuotas.upstreamKeyId, id))
        .get()) ?? null;
    const candidateCount =
      (
        await db
          .select({ count: sql<number>`count(*)` })
          .from(publicModelCandidates)
          .where(eq(publicModelCandidates.upstreamKeyId, id))
          .get()
      )?.count ?? 0;
    await audit(db, auditMetaFromRequest(req), 'upstream_key.create', id, {
      name,
      providerType,
      baseUrl,
    });
    return presentUpstreamKey(row, quota, [], candidateCount);
  });

  app.patch('/api/admin/upstream-keys/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Partial<CreateUpstreamKeyBody> & { enabled?: boolean };
    const existing = await db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    if (!existing) {
      reply.code(404).send({
        error: {
          message: 'upstream key not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }
    const now = new Date();
    const update: Partial<typeof upstreamKeys.$inferInsert> = { updatedAt: now };
    if (typeof body.name === 'string' && body.name.trim() !== existing.name) {
      const dup = await db
        .select()
        .from(upstreamKeys)
        .where(eq(upstreamKeys.name, body.name.trim()))
        .get();
      if (dup) {
        reply.code(409).send({
          error: {
            message: 'upstream key name already in use',
            type: 'validation_error',
            code: 'validation_error',
          },
        });
        return;
      }
      update.name = body.name.trim();
    }
    if (typeof body.baseUrl === 'string') update.baseUrl = body.baseUrl.trim();
    if (typeof body.providerType === 'string') {
      assertProviderType(body.providerType);
      update.providerType = body.providerType;
    }
    if (body.endpoints !== undefined) {
      const endpoints = normalizeEndpoints(body.endpoints);
      if (endpoints.length === 0) {
        throw new ValidationError('endpoints must contain at least one endpoint');
      }
      update.endpointsJson = JSON.stringify(endpoints);
      // Keep the legacy single-endpoint fields in sync with the first endpoint.
      update.providerType = endpoints[0]!.providerType;
      update.baseUrl = endpoints[0]!.baseUrl;
    }
    if (Array.isArray(body.supportedModels)) {
      update.supportedModelsJson = JSON.stringify(
        body.supportedModels.filter((x): x is string => typeof x === 'string'),
      );
    }
    if (typeof body.authType === 'string') {
      update.authType = assertAuthType(body.authType);
    }
    if (body.authConfig !== undefined) {
      const currentAuthType = (update.authType ?? existing.authType) as UpstreamAuthType;
      const rawAuthConfig = extractAuthConfig(body.authConfig);
      const validated = validateAuthConfig(currentAuthType, rawAuthConfig);
      update.authConfigCiphertext = encryptSecret(JSON.stringify(validated), secretKey).ciphertext;
    }
    if (body.defaultHeaders !== undefined) {
      update.defaultHeadersJson = safeJsonString(body.defaultHeaders, '{}');
    }
    if (body.extraHeaders !== undefined) {
      update.extraHeadersJson = safeJsonString(normalizeExtraHeaders(body.extraHeaders), '{}');
    }
    if (body.extraParams !== undefined) {
      update.extraParamsJson = safeJsonString(normalizeExtraParams(body.extraParams), '{}');
    }
    if (typeof body.enabled === 'boolean') update.enabled = body.enabled;
    await db.update(upstreamKeys).set(update).where(eq(upstreamKeys.id, id));

    if (body.quota) {
      const period = typeof body.quota.period === 'string' ? body.quota.period : '';
      assertQuotaPeriod(period);
      const existingQ = await db
        .select()
        .from(upstreamKeyQuotas)
        .where(eq(upstreamKeyQuotas.upstreamKeyId, id))
        .get();
      const values = {
        period,
        requestLimit: assertPositiveInt('requestLimit', body.quota.requestLimit),
        inputTokenLimit: assertPositiveInt('inputTokenLimit', body.quota.inputTokenLimit),
        outputTokenLimit: assertPositiveInt('outputTokenLimit', body.quota.outputTokenLimit),
        totalTokenLimit: assertPositiveInt('totalTokenLimit', body.quota.totalTokenLimit),
        enabled: true,
        updatedAt: now,
      };
      if (existingQ) {
        await db
          .update(upstreamKeyQuotas)
          .set(values)
          .where(eq(upstreamKeyQuotas.upstreamKeyId, id));
      } else {
        await db.insert(upstreamKeyQuotas).values({
          id: generateId('upstreamKey') + '_q',
          upstreamKeyId: id,
          ...values,
          createdAt: now,
        });
      }
    }

    const row = await db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    if (!row) throw new Error('not found');
    const quota =
      (await db
        .select()
        .from(upstreamKeyQuotas)
        .where(eq(upstreamKeyQuotas.upstreamKeyId, id))
        .get()) ?? null;
    await audit(db, auditMetaFromRequest(req), 'upstream_key.update', id, {
      name: row.name,
      enabled: row.enabled,
    });
    return presentUpstreamKey(row, quota, []);
  });

  app.post('/api/admin/upstream-keys/:id/rotate-secret', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
    if (!apiKey) throw new ValidationError('apiKey is required');
    const existing = await db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    if (!existing) {
      reply.code(404).send({
        error: {
          message: 'upstream key not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }
    const { ciphertext, prefix } = encryptUpstreamApiKey(apiKey, secretKey);
    await db
      .update(upstreamKeys)
      .set({ apiKeyCiphertext: ciphertext, apiKeyPrefix: prefix, updatedAt: new Date() })
      .where(eq(upstreamKeys.id, id));
    await audit(db, auditMetaFromRequest(req), 'upstream_key.rotate_secret', id, {
      apiKeyPrefix: prefix,
    });
    return { id, apiKeyPrefix: prefix };
  });

  app.get('/api/admin/upstream-keys/:id/candidates', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    if (!existing) {
      reply.code(404).send({
        error: {
          message: 'upstream key not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }
    const candidates = await getUpstreamKeyCandidates(db, id);
    return { items: candidates };
  });

  app.put('/api/admin/upstream-keys/:id/candidates', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { mappings?: unknown };
    const existing = await db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    if (!existing) {
      reply.code(404).send({
        error: {
          message: 'upstream key not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }
    if (!Array.isArray(body.mappings)) {
      throw new ValidationError('mappings must be an array');
    }
    const mappings: UpstreamKeyCandidateMapping[] = [];
    for (const raw of body.mappings) {
      if (!raw || typeof raw !== 'object') {
        throw new ValidationError('each mapping must be an object');
      }
      const publicName =
        typeof (raw as { publicName?: unknown }).publicName === 'string'
          ? (raw as { publicName: string }).publicName.trim()
          : '';
      const realName =
        typeof (raw as { realName?: unknown }).realName === 'string'
          ? (raw as { realName: string }).realName.trim()
          : '';
      if (!realName) {
        throw new ValidationError('mapping realName is required');
      }
      const enabled = (raw as { enabled?: unknown }).enabled === false ? false : true;
      mappings.push({ publicName: publicName || realName, realName, enabled });
    }
    const candidates = await syncUpstreamKeyMappings(db, id, mappings);
    await audit(db, auditMetaFromRequest(req), 'upstream_key.update', id, {
      candidates: candidates.length,
    });
    return { items: candidates };
  });

  app.post('/api/admin/upstream-keys/:id/ping', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as PingUpstreamKeyBody;
    const realModelName = typeof body.realModelName === 'string' ? body.realModelName.trim() : '';
    if (!realModelName) {
      throw new ValidationError('realModelName is required');
    }
    const existing = await db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    if (!existing) {
      reply.code(404).send({
        error: {
          message: 'upstream key not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }

    const result = await pingUpstreamModel(existing, realModelName, secretKey, db);
    const now = new Date();
    await db
      .update(upstreamKeys)
      .set({
        lastHealthStatus: result.ok ? 'healthy' : 'unhealthy',
        lastErrorCode: result.error?.type ?? null,
        lastErrorMessage: result.error?.message ?? null,
        updatedAt: now,
      })
      .where(eq(upstreamKeys.id, id));

    await db
      .update(publicModelCandidates)
      .set({
        lastPingAt: now,
        lastPingOk: result.ok,
        lastPingStatus: result.status ?? null,
        lastPingLatencyMs: result.latencyMs,
        lastPingError: result.error?.message ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(publicModelCandidates.upstreamKeyId, id),
          eq(publicModelCandidates.realModelName, realModelName),
        ),
      );

    return result;
  });

  app.post('/api/admin/upstream-keys/:id/freeze', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason : 'manually frozen';
    const existing = await db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    if (!existing) {
      reply.code(404).send({
        error: {
          message: 'upstream key not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }
    await db
      .update(upstreamKeys)
      .set({ frozen: true, frozenReason: reason, updatedAt: new Date() })
      .where(eq(upstreamKeys.id, id));
    await audit(db, auditMetaFromRequest(req), 'upstream_key.freeze', id, { reason });
    return { id, frozen: true, frozenReason: reason };
  });

  app.post('/api/admin/upstream-keys/:id/unfreeze', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    if (!existing) {
      reply.code(404).send({
        error: {
          message: 'upstream key not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }
    await db
      .update(upstreamKeys)
      .set({ frozen: false, frozenReason: null, updatedAt: new Date() })
      .where(eq(upstreamKeys.id, id));
    await audit(db, auditMetaFromRequest(req), 'upstream_key.unfreeze', id);
    return { id, frozen: false };
  });
  // M6: list sticky bindings for a consumer key. Optional filter by
  // requestedTargetName; defaults to listing all.
  app.get('/api/admin/sticky-bindings', async (req) => {
    const { appId, consumerKeyId, requestedTargetName } = req.query as {
      appId?: string;
      consumerKeyId?: string;
      requestedTargetName?: string;
    };
    if (!appId || !consumerKeyId) {
      return { items: [] };
    }
    let rows = await listStickyBindingsForConsumer(db, { appId, consumerKeyId });
    if (requestedTargetName) {
      rows = rows.filter((r) => r.requestedTargetName === requestedTargetName);
    }
    return { items: rows };
  });

  // M6: run a maintenance pass now. Resets expired counters and prunes
  // expired sticky bindings. Idempotent and safe to call from cron.
  app.post('/api/admin/maintenance/run', async () => {
    const countersRemoved = await resetExpiredCounters(db, new Date());
    const stickyRemoved = await pruneExpiredStickyBindings(db, new Date());
    return { countersRemoved, stickyRemoved };
  });

  app.post('/api/admin/upstream-keys/discover-models', async (req, reply) => {
    const body = (req.body ?? {}) as DiscoverModelsBody;
    try {
      const items = await discoverUpstreamModels({ body, db, secretKey });
      return { items };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(502).send({
        error: { message, type: 'upstream_error', code: 'upstream_error' },
      });
    }
  });

  // Built-in provider presets for the admin onboarding UI.
  app.get('/api/admin/provider-presets', async () => {
    return {
      items: listProviderPresets().map((preset) => ({
        ...preset,
        modelMappings: getModelMappings(preset),
      })),
    };
  });

  app.delete('/api/admin/upstream-keys/:id', async (req) => {
    const { id } = req.params as { id: string };
    await db.delete(upstreamKeys).where(eq(upstreamKeys.id, id));
    await audit(db, auditMetaFromRequest(req), 'upstream_key.delete', id);
    return { id, deleted: true };
  });
}

// Exported for test use only; decrypts the stored ciphertext using the secret key.
export function decryptUpstreamApiKeyForTest(ciphertext: string, secretKey: string): string {
  return decryptUpstreamApiKey(ciphertext, secretKey);
}
