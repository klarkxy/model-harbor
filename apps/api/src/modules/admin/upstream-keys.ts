import { eq, desc } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { generateId, ValidationError, type ProviderType } from '@modelharbor/shared';
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
  safeJsonString,
} from './helpers.js';

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
  defaultHeaders?: unknown;
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
    apiKeyPrefix: row.apiKeyPrefix,
    defaultHeaders: parseJsonObject(row.defaultHeadersJson),
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

interface DiscoverModelsBody {
  baseUrl?: unknown;
  apiKey?: unknown;
  providerType?: unknown;
  providerPresetId?: unknown;
  upstreamKeyId?: unknown;
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

interface DiscoverContext {
  body: DiscoverModelsBody;
  db: Db;
  secretKey: string;
}

async function discoverUpstreamModels(
  ctx: DiscoverContext,
): Promise<Array<{ realName: string; publicName: string }>> {
  const { body, db, secretKey } = ctx;
  const fallbackBaseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  let apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
  const rawProviderType = typeof body.providerType === 'string' ? body.providerType : '';
  const upstreamKeyId = typeof body.upstreamKeyId === 'string' ? body.upstreamKeyId : '';

  if (!apiKey && upstreamKeyId) {
    const upstreamKey = await db
      .select()
      .from(upstreamKeys)
      .where(eq(upstreamKeys.id, upstreamKeyId))
      .get();
    if (!upstreamKey) {
      throw new ValidationError('upstream key not found');
    }
    apiKey = decryptUpstreamApiKey(upstreamKey.apiKeyCiphertext, secretKey);
  }

  if (!apiKey) throw new ValidationError('apiKey is required');
  assertProviderType(rawProviderType);

  const presetId = typeof body.providerPresetId === 'string' ? body.providerPresetId : '';
  const preset = presetId ? getProviderPreset(presetId) : undefined;
  const { baseUrl, providerType } = resolveDiscoveryEndpoint(
    preset,
    fallbackBaseUrl,
    rawProviderType as ProviderType,
  );
  if (!baseUrl) throw new ValidationError('baseUrl is required');

  const headers: Record<string, string> = {
    accept: 'application/json',
  };
  if (providerType === 'anthropic_compatible') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
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
    if (ids.length === 0) {
      throw new Error('upstream returned no models');
    }

    const realToPublic = new Map<string, string>();
    if (preset) {
      for (const mapping of getModelMappings(preset)) {
        realToPublic.set(mapping.realName, mapping.publicName);
      }
    }

    return ids.map((realName) => ({
      realName,
      publicName: realToPublic.get(realName) ?? realName,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[modelharbor upstream] discover models <-- transport/error ${buildModelsUrl(baseUrl)}`,
      { message },
    );
    if (message === 'upstream returned no models') throw err;
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
    if (!apiKey) throw new ValidationError('apiKey is required');

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

    const { ciphertext, prefix } = encryptUpstreamApiKey(apiKey, secretKey);
    const id = generateId('upstreamKey');
    const now = new Date();
    await db.insert(upstreamKeys).values({
      id,
      name,
      providerType,
      baseUrl,
      apiKeyCiphertext: ciphertext,
      apiKeyPrefix: prefix,
      defaultHeadersJson: safeJsonString(body.defaultHeaders, '{}'),
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
        const groupName = preset ? preset.name : name;
        await onboardUpstreamKeyWithMappings(db, id, groupName, modelMappings);
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
    await audit(db, auditMetaFromRequest(req), 'upstream_key.create', id, {
      name,
      providerType,
      baseUrl,
    });
    return presentUpstreamKey(row, quota, []);
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
    if (body.defaultHeaders !== undefined) {
      update.defaultHeadersJson = safeJsonString(body.defaultHeaders, '{}');
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
