import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { asc, eq, and } from 'drizzle-orm';
import { publicModelCandidates, publicModels } from '../src/modules/db/tables/models.js';
import { upstreamKeys } from '../src/modules/db/tables/upstream.js';
import { decryptUpstreamApiKeyForTest } from '../src/modules/admin/index.js';
import { makeAdminRig, type AdminTestRig } from './helper.js';
import { startFakeUpstream } from './fake-upstream.js';

describe('upstream keys admin', () => {
  let rig: AdminTestRig;
  beforeEach(async () => {
    rig = await makeAdminRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('creates an upstream key and never returns the raw apiKey in any subsequent response', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'deepseek-1',
        providerType: 'anthropic_compatible',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-supersecret-DO-NOT-LEAK',
        supportedModels: ['ds-v4-flash'],
        quota: {
          period: 'month',
          requestLimit: 100000,
          inputTokenLimit: 10000000,
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; apiKeyPrefix: string; quota: { period: string } };
    expect(body.id).toBeTruthy();
    expect(body.apiKeyPrefix).toBe('sk-s');
    expect(body.quota?.period).toBe('month');
    // The raw secret must not appear anywhere in the create response.
    expect(JSON.stringify(body)).not.toContain('supersecret');

    // GET list
    const list = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain('supersecret');

    // GET detail
    const detail = await rig.app.inject({
      method: 'GET',
      url: `/api/admin/upstream-keys/${body.id}`,
      headers: { cookie: rig.cookie },
    });
    expect(JSON.stringify(detail.json())).not.toContain('supersecret');
  });

  it('encrypts the stored api key so the plaintext is not in the database', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'deepseek-2',
        providerType: 'openai_compatible',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-plaintextvalue-XYZ',
      },
    });
    const body = res.json() as { id: string };
    const row = await rig.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, body.id)).get();
    expect(row).toBeTruthy();
    expect(row!.apiKeyCiphertext).not.toContain('plaintextvalue');
    // The encryption helper should round-trip
    expect(decryptUpstreamApiKeyForTest(row!.apiKeyCiphertext, rig.secretKey)).toBe(
      'sk-plaintextvalue-XYZ',
    );
  });

  it('rejects invalid providerType', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'bad',
        providerType: 'weird',
        baseUrl: 'https://x.com',
        apiKey: 'k',
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects duplicate name with 409', async () => {
    const payload = {
      name: 'dup',
      providerType: 'anthropic_compatible' as const,
      baseUrl: 'https://x.com',
      apiKey: 'k1',
    };
    const r1 = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload,
    });
    expect(r1.statusCode).toBe(200);
    const r2 = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: { ...payload, apiKey: 'k2' },
    });
    expect(r2.statusCode).toBe(409);
  });

  it('freezes and unfreezes an upstream key', async () => {
    const c = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'frz',
        providerType: 'anthropic_compatible',
        baseUrl: 'https://x.com',
        apiKey: 'k',
      },
    });
    const id = (c.json() as { id: string }).id;
    const frz = await rig.app.inject({
      method: 'POST',
      url: `/api/admin/upstream-keys/${id}/freeze`,
      headers: { cookie: rig.cookie },
      payload: { reason: 'manual test' },
    });
    expect(frz.statusCode).toBe(200);
    expect((frz.json() as { frozen: boolean }).frozen).toBe(true);
    const unf = await rig.app.inject({
      method: 'POST',
      url: `/api/admin/upstream-keys/${id}/unfreeze`,
      headers: { cookie: rig.cookie },
    });
    expect(unf.statusCode).toBe(200);
    expect((unf.json() as { frozen: boolean }).frozen).toBe(false);
  });

  it('rotates the secret and updates the prefix', async () => {
    const c = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'rot',
        providerType: 'anthropic_compatible',
        baseUrl: 'https://x.com',
        apiKey: 'old-key-1234',
      },
    });
    const id = (c.json() as { id: string }).id;
    const rot = await rig.app.inject({
      method: 'POST',
      url: `/api/admin/upstream-keys/${id}/rotate-secret`,
      headers: { cookie: rig.cookie },
      payload: { apiKey: 'new-key-5678' },
    });
    expect(rot.statusCode).toBe(200);
    expect((rot.json() as { apiKeyPrefix: string }).apiKeyPrefix).toBe('new-');
    const row = await rig.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    expect(row!.apiKeyPrefix).toBe('new-');
    expect(decryptUpstreamApiKeyForTest(row!.apiKeyCiphertext, rig.secretKey)).toBe('new-key-5678');
  });

  it('creates an upstream key with explicit endpoints', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'multi-endpoint',
        apiKey: 'sk-multi',
        endpoints: [
          {
            protocol: 'anthropic',
            baseUrl: 'https://api.minimaxi.com/anthropic',
            providerType: 'anthropic_compatible',
          },
          {
            protocol: 'openai',
            baseUrl: 'https://api.minimaxi.com',
            providerType: 'openai_compatible',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      id: string;
      endpoints: Array<{ protocol: string; baseUrl: string; providerType: string }>;
      providerPresetId: string | null;
    };
    expect(body.endpoints).toHaveLength(2);
    expect(body.endpoints[0]?.protocol).toBe('anthropic');
    expect(body.endpoints[1]?.protocol).toBe('openai');
    expect(body.providerPresetId).toBeNull();

    const row = await rig.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, body.id)).get();
    expect(row).toBeTruthy();
    expect(row!.providerType).toBe('anthropic_compatible');
    expect(row!.baseUrl).toBe('https://api.minimaxi.com/anthropic');
  });

  it('preserves endpoint apiPath override', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'zhipu-like',
        apiKey: 'sk-zhipu',
        endpoints: [
          {
            protocol: 'openai',
            baseUrl: 'https://open.bigmodel.cn/api/paas',
            providerType: 'openai_compatible',
            apiPath: '/v4/chat/completions',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      endpoints: Array<{
        protocol: string;
        baseUrl: string;
        providerType: string;
        apiPath?: string;
      }>;
    };
    expect(body.endpoints).toHaveLength(1);
    expect(body.endpoints[0]?.apiPath).toBe('/v4/chat/completions');
  });

  it('creates an upstream key from the MiniMax preset without auto-onboarding hardcoded models', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'minimax-1',
        apiKey: 'sk-minimax',
        providerPresetId: 'minimax',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; endpoints: unknown[]; providerPresetId: string };
    expect(body.providerPresetId).toBe('minimax');
    expect(body.endpoints).toHaveLength(2);

    // No hardcoded models means no public models or candidates are auto-created.
    const candidates = await rig.db
      .select()
      .from(publicModelCandidates)
      .where(eq(publicModelCandidates.upstreamKeyId, body.id))
      .all();
    expect(candidates).toHaveLength(0);
  });

  it('creates an upstream key with custom model mappings', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'custom-mappings-1',
        apiKey: 'sk-custom',
        providerPresetId: 'openai',
        modelMappings: [
          { realName: 'gpt-4o', publicName: 'gpt-4o', enabled: true },
          { realName: 'gpt-4o-mini', enabled: false },
          { realName: 'my-custom-model', publicName: 'custom-public', enabled: true },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string };

    const candidates = await rig.db
      .select()
      .from(publicModelCandidates)
      .where(eq(publicModelCandidates.upstreamKeyId, body.id))
      .all();
    const byRealName = new Map(candidates.map((c) => [c.realModelName, c]));

    // Enabled mappings become candidates.
    expect(byRealName.has('gpt-4o')).toBe(true);
    expect(byRealName.has('my-custom-model')).toBe(true);

    // Disabled mapping is skipped.
    expect(byRealName.has('gpt-4o-mini')).toBe(false);

    // Custom public name is respected.
    expect(byRealName.get('my-custom-model')!.publicModelId).toBeTruthy();
    const publicModel = await rig.db
      .select()
      .from(publicModels)
      .where(eq(publicModels.id, byRealName.get('my-custom-model')!.publicModelId))
      .get();
    expect(publicModel!.name).toBe('custom-public');
  });

  it('stores endpoint overrides from custom model mappings', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'custom-mapping-endpoint-1',
        apiKey: 'sk-custom',
        providerPresetId: 'opencode-go',
        modelMappings: [
          {
            realName: 'qwen3.7-plus',
            publicName: 'qwen3.7-plus',
            enabled: true,
            endpointProtocol: 'anthropic',
            endpointProviderType: 'anthropic_compatible',
            endpointBaseUrl: 'https://opencode.ai/zen/go',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string };

    const candidates = await rig.db
      .select()
      .from(publicModelCandidates)
      .where(eq(publicModelCandidates.upstreamKeyId, body.id))
      .all();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      realModelName: 'qwen3.7-plus',
      endpointProtocol: 'anthropic',
      endpointProviderType: 'anthropic_compatible',
      endpointBaseUrl: 'https://opencode.ai/zen/go',
    });
  });

  it('uses upstream key order as the default public model candidate order', async () => {
    const first = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'default-order-a',
        apiKey: 'sk-a',
        providerPresetId: 'openai',
        modelMappings: [{ realName: 'shared-a', publicName: 'shared-public', enabled: true }],
      },
    });
    const second = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'default-order-b',
        apiKey: 'sk-b',
        providerPresetId: 'openai',
        modelMappings: [{ realName: 'shared-b', publicName: 'shared-public', enabled: true }],
      },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstBody = first.json() as { id: string };
    const secondBody = second.json() as { id: string };

    const reorder = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/upstream-keys/order',
      headers: { cookie: rig.cookie },
      payload: { ids: [secondBody.id, firstBody.id] },
    });
    expect(reorder.statusCode).toBe(200);

    const publicModel = await rig.db
      .select()
      .from(publicModels)
      .where(eq(publicModels.name, 'shared-public'))
      .get();
    expect(publicModel).toBeTruthy();
    const rows = await rig.db
      .select({ c: publicModelCandidates, u: upstreamKeys })
      .from(publicModelCandidates)
      .innerJoin(upstreamKeys, eq(publicModelCandidates.upstreamKeyId, upstreamKeys.id))
      .where(eq(publicModelCandidates.publicModelId, publicModel!.id))
      .orderBy(asc(publicModelCandidates.priority))
      .all();
    expect(rows.map(({ u }) => u.id)).toEqual([secondBody.id, firstBody.id]);
    expect(rows.map(({ c }) => c.priority)).toEqual([10, 20]);
  });

  it('appends new candidates after a public model has been manually arranged', async () => {
    const first = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'custom-order-a',
        apiKey: 'sk-a',
        providerPresetId: 'openai',
        modelMappings: [{ realName: 'shared-a', publicName: 'shared-custom', enabled: true }],
      },
    });
    const second = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'custom-order-b',
        apiKey: 'sk-b',
        providerPresetId: 'openai',
        modelMappings: [{ realName: 'shared-b', publicName: 'shared-custom', enabled: true }],
      },
    });
    const firstBody = first.json() as { id: string };
    const secondBody = second.json() as { id: string };
    const publicModel = await rig.db
      .select()
      .from(publicModels)
      .where(eq(publicModels.name, 'shared-custom'))
      .get();
    expect(publicModel).toBeTruthy();

    const customArrange = await rig.app.inject({
      method: 'PUT',
      url: `/api/admin/public-models/${publicModel!.id}/candidates`,
      headers: { cookie: rig.cookie },
      payload: {
        candidates: [
          { upstreamKeyId: secondBody.id, realModelName: 'shared-b', priority: 10, weight: 1 },
          { upstreamKeyId: firstBody.id, realModelName: 'shared-a', priority: 20, weight: 1 },
        ],
      },
    });
    expect(customArrange.statusCode).toBe(200);

    const third = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'custom-order-c',
        apiKey: 'sk-c',
        providerPresetId: 'openai',
        modelMappings: [{ realName: 'shared-c', publicName: 'shared-custom', enabled: true }],
      },
    });
    expect(third.statusCode).toBe(200);

    const rows = await rig.db
      .select()
      .from(publicModelCandidates)
      .where(eq(publicModelCandidates.publicModelId, publicModel!.id))
      .orderBy(asc(publicModelCandidates.priority))
      .all();
    expect(rows.map((row) => row.realModelName)).toEqual(['shared-b', 'shared-a', 'shared-c']);
    expect(rows.map((row) => row.priority)).toEqual([10, 20, 30]);

    const reset = await rig.app.inject({
      method: 'POST',
      url: `/api/admin/public-models/${publicModel!.id}/candidates/reset-order`,
      headers: { cookie: rig.cookie },
    });
    expect(reset.statusCode).toBe(200);
    const resetRows = await rig.db
      .select({ c: publicModelCandidates, u: upstreamKeys })
      .from(publicModelCandidates)
      .innerJoin(upstreamKeys, eq(publicModelCandidates.upstreamKeyId, upstreamKeys.id))
      .where(eq(publicModelCandidates.publicModelId, publicModel!.id))
      .orderBy(asc(publicModelCandidates.priority))
      .all();
    expect(resetRows.map(({ u }) => u.id)).toEqual([firstBody.id, secondBody.id, (third.json() as { id: string }).id]);
  });

  it('duplicates a PAT upstream key as failover and copies candidate endpoint overrides', async () => {
    const create = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'opencode-source',
        apiKey: 'sk-source',
        providerPresetId: 'opencode-go',
        extraHeaders: { 'x-custom': 'source' },
        extraParams: { seed: 42 },
        stickySessionTtlMs: 12345,
        modelMappings: [
          {
            realName: 'qwen3.7-plus',
            publicName: 'qwen3.7-plus',
            enabled: true,
            endpointProtocol: 'anthropic',
            endpointProviderType: 'anthropic_compatible',
            endpointBaseUrl: 'https://opencode.ai/zen/go',
          },
        ],
      },
    });
    expect(create.statusCode).toBe(200);
    const source = create.json() as { id: string };
    await rig.db
      .update(upstreamKeys)
      .set({
        frozen: true,
        frozenReason: 'source frozen',
        cooldownUntil: new Date(Date.now() + 60_000),
        lastHealthStatus: 'unhealthy',
        lastErrorCode: 'boom',
        lastErrorMessage: 'source error',
      })
      .where(eq(upstreamKeys.id, source.id));

    const duplicate = await rig.app.inject({
      method: 'POST',
      url: `/api/admin/upstream-keys/${source.id}/duplicate`,
      headers: { cookie: rig.cookie },
      payload: {
        name: 'opencode-backup',
        apiKey: 'sk-backup',
      },
    });
    expect(duplicate.statusCode).toBe(200);
    const body = duplicate.json() as {
      id: string;
      name: string;
      frozen: boolean;
      cooldownUntil: string | null;
      extraHeaders: Record<string, string>;
      extraParams: Record<string, unknown>;
      stickySessionTtlMs: number;
      candidateCount: number;
      providerPresetId: string;
    };
    expect(body.name).toBe('opencode-backup');
    expect(body.providerPresetId).toBe('opencode-go');
    expect(body.frozen).toBe(false);
    expect(body.cooldownUntil).toBeNull();
    expect(body.extraHeaders).toEqual({ 'x-custom': 'source' });
    expect(body.extraParams).toEqual({ seed: 42 });
    expect(body.stickySessionTtlMs).toBe(12345);
    expect(body.candidateCount).toBe(1);

    const row = await rig.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, body.id)).get();
    expect(row).toBeTruthy();
    expect(row!.lastHealthStatus).toBeNull();
    expect(row!.lastErrorCode).toBeNull();
    expect(decryptUpstreamApiKeyForTest(row!.apiKeyCiphertext, rig.secretKey)).toBe('sk-backup');

    const candidates = await rig.db
      .select()
      .from(publicModelCandidates)
      .where(eq(publicModelCandidates.upstreamKeyId, body.id))
      .all();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      realModelName: 'qwen3.7-plus',
      priority: 20,
      weight: 1,
      endpointProtocol: 'anthropic',
      endpointProviderType: 'anthropic_compatible',
      endpointBaseUrl: 'https://opencode.ai/zen/go',
    });
  });

  it('duplicates a PAT upstream key as pool without changing candidate priority', async () => {
    const create = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'pool-source',
        apiKey: 'sk-source',
        providerPresetId: 'openai',
        modelMappings: [{ realName: 'gpt-4o', publicName: 'gpt-4o', enabled: true }],
      },
    });
    expect(create.statusCode).toBe(200);
    const source = create.json() as { id: string };
    await rig.db
      .update(publicModelCandidates)
      .set({ priority: 25, weight: 7 })
      .where(eq(publicModelCandidates.upstreamKeyId, source.id));

    const duplicate = await rig.app.inject({
      method: 'POST',
      url: `/api/admin/upstream-keys/${source.id}/duplicate`,
      headers: { cookie: rig.cookie },
      payload: {
        name: 'pool-copy',
        apiKey: 'sk-copy',
        routingMode: 'pool',
      },
    });
    expect(duplicate.statusCode).toBe(200);
    const body = duplicate.json() as { id: string };

    const candidates = await rig.db
      .select()
      .from(publicModelCandidates)
      .where(eq(publicModelCandidates.upstreamKeyId, body.id))
      .all();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ realModelName: 'gpt-4o', priority: 25, weight: 7 });
  });

  it('stores and returns extra headers and parameters', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'extras-1',
        apiKey: 'sk-extras',
        providerPresetId: 'openai',
        extraHeaders: { 'x-custom': 'foo' },
        extraParams: { seed: 42 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      id: string;
      extraHeaders: Record<string, string>;
      extraParams: Record<string, unknown>;
    };
    expect(body.extraHeaders).toEqual({ 'x-custom': 'foo' });
    expect(body.extraParams).toEqual({ seed: 42 });

    const row = await rig.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, body.id)).get();
    expect(row).toBeTruthy();
    expect(JSON.parse(row!.extraHeadersJson!)).toEqual({ 'x-custom': 'foo' });
    expect(JSON.parse(row!.extraParamsJson!)).toEqual({ seed: 42 });
  });

  it('pings a candidate model through the upstream key', async () => {
    const fake = await startFakeUpstream();
    try {
      const create = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/upstream-keys',
        headers: { cookie: rig.cookie },
        payload: {
          name: 'ping-ok',
          apiKey: 'sk-ping',
          providerType: 'openai_compatible',
          baseUrl: fake.baseUrl,
          modelMappings: [{ realName: 'fake-model', publicName: 'fake-model', enabled: true }],
        },
      });
      expect(create.statusCode).toBe(200);
      const { id } = create.json() as { id: string };

      const ping = await rig.app.inject({
        method: 'POST',
        url: `/api/admin/upstream-keys/${id}/ping`,
        headers: { cookie: rig.cookie },
        payload: { realModelName: 'fake-model' },
      });
      expect(ping.statusCode).toBe(200);
      const result = ping.json() as { ok: boolean; status?: number; latencyMs: number };
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);

      const row = await rig.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
      expect(row!.lastHealthStatus).toBe('healthy');
      expect(row!.lastErrorCode).toBeNull();

      const candidate = await rig.db
        .select()
        .from(publicModelCandidates)
        .where(
          and(
            eq(publicModelCandidates.upstreamKeyId, id),
            eq(publicModelCandidates.realModelName, 'fake-model'),
          ),
        )
        .get();
      expect(candidate).toBeTruthy();
      expect(candidate!.lastPingOk).toBe(true);
      expect(candidate!.lastPingStatus).toBe(200);
      expect(candidate!.lastPingLatencyMs).toBeGreaterThanOrEqual(0);
      expect(candidate!.lastPingAt).toBeTruthy();
      expect(candidate!.lastPingError).toBeNull();
    } finally {
      await fake.close();
    }
  });

  it('reports failure when ping upstream returns an error', async () => {
    const fake = await startFakeUpstream();
    try {
      fake.setOpenAIResponse({
        status: 401,
        body: { error: { message: 'Unauthorized', type: 'authentication_error' } },
      });
      const create = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/upstream-keys',
        headers: { cookie: rig.cookie },
        payload: {
          name: 'ping-fail',
          apiKey: 'sk-ping-fail',
          providerType: 'openai_compatible',
          baseUrl: fake.baseUrl,
          modelMappings: [{ realName: 'fake-model', publicName: 'fake-model', enabled: true }],
        },
      });
      expect(create.statusCode).toBe(200);
      const { id } = create.json() as { id: string };

      const ping = await rig.app.inject({
        method: 'POST',
        url: `/api/admin/upstream-keys/${id}/ping`,
        headers: { cookie: rig.cookie },
        payload: { realModelName: 'fake-model' },
      });
      expect(ping.statusCode).toBe(200);
      const result = ping.json() as {
        ok: boolean;
        status?: number;
        error?: { type: string; message: string };
      };
      expect(result.ok).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toBeTruthy();

      const row = await rig.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
      expect(row!.lastHealthStatus).toBe('unhealthy');
      expect(row!.lastErrorCode).toBe('upstream_error');

      const candidate = await rig.db
        .select()
        .from(publicModelCandidates)
        .where(
          and(
            eq(publicModelCandidates.upstreamKeyId, id),
            eq(publicModelCandidates.realModelName, 'fake-model'),
          ),
        )
        .get();
      expect(candidate).toBeTruthy();
      expect(candidate!.lastPingOk).toBe(false);
      expect(candidate!.lastPingStatus).toBe(401);
      expect(candidate!.lastPingAt).toBeTruthy();
      expect(candidate!.lastPingError).toContain('401');
    } finally {
      await fake.close();
    }
  });

  it('updates an upstream key and syncs candidates', async () => {
    const create = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'editable-1',
        apiKey: 'sk-edit',
        providerPresetId: 'openai',
        modelMappings: [
          { realName: 'gpt-4o', publicName: 'gpt-4o', enabled: true },
          { realName: 'gpt-4o-mini', publicName: 'gpt-4o-mini', enabled: true },
        ],
      },
    });
    expect(create.statusCode).toBe(200);
    const { id } = create.json() as { id: string };

    // Update name.
    const patch = await rig.app.inject({
      method: 'PATCH',
      url: `/api/admin/upstream-keys/${id}`,
      headers: { cookie: rig.cookie },
      payload: { name: 'editable-renamed' },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { name: string }).name).toBe('editable-renamed');

    // Rotate secret.
    const rotate = await rig.app.inject({
      method: 'POST',
      url: `/api/admin/upstream-keys/${id}/rotate-secret`,
      headers: { cookie: rig.cookie },
      payload: { apiKey: 'sk-edit-new' },
    });
    expect(rotate.statusCode).toBe(200);
    expect((rotate.json() as { apiKeyPrefix: string }).apiKeyPrefix).toBe('sk-e');

    // Get candidates.
    const getCandidates = await rig.app.inject({
      method: 'GET',
      url: `/api/admin/upstream-keys/${id}/candidates`,
      headers: { cookie: rig.cookie },
    });
    expect(getCandidates.statusCode).toBe(200);
    const initialCandidates = (getCandidates.json() as { items: Array<{ realName: string }> })
      .items;
    expect(initialCandidates.length).toBe(2);

    // Sync candidates: keep one, add one, remove one.
    const sync = await rig.app.inject({
      method: 'PUT',
      url: `/api/admin/upstream-keys/${id}/candidates`,
      headers: { cookie: rig.cookie },
      payload: {
        mappings: [
          { realName: 'gpt-4o', publicName: 'gpt-4o', enabled: true },
          { realName: 'gpt-4-turbo', publicName: 'gpt-4-turbo', enabled: true },
        ],
      },
    });
    expect(sync.statusCode).toBe(200);
    const synced = (sync.json() as { items: Array<{ realName: string }> }).items;
    const realNames = synced.map((c) => c.realName).sort();
    expect(realNames).toEqual(['gpt-4-turbo', 'gpt-4o']);

    const remaining = await rig.db
      .select()
      .from(publicModelCandidates)
      .where(eq(publicModelCandidates.upstreamKeyId, id))
      .all();
    expect(remaining.map((c) => c.realModelName).sort()).toEqual(['gpt-4-turbo', 'gpt-4o']);
  });

  it('rejects empty realName in modelMappings', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'bad-mapping',
        apiKey: 'sk-bad',
        providerPresetId: 'openai',
        modelMappings: [{ realName: '', publicName: 'x', enabled: true }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires admin cookie for create', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      payload: {
        name: 'no',
        providerType: 'anthropic_compatible',
        baseUrl: 'https://x.com',
        apiKey: 'k',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lists built-in provider presets', async () => {
    const res = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/provider-presets',
      headers: { cookie: rig.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{
        id: string;
        name: string;
        icon?: string;
        endpoints: unknown[];
        modelMappings: unknown[];
      }>;
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((p) => p.id === 'codex')).toBe(false);
    const openai = body.items.find((p) => p.id === 'openai');
    expect(openai).toBeTruthy();
    expect(openai!.icon).toBeTruthy();
    expect(openai!.endpoints.length).toBeGreaterThan(0);
    expect(openai!.modelMappings).toHaveLength(0);
  });

  describe('discover models', () => {
    let originalFetch: typeof global.fetch;
    beforeEach(() => {
      originalFetch = global.fetch;
    });
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('discovers models from an upstream /v1/models endpoint', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'model-a', object: 'model' },
              { id: 'model-b', object: 'model' },
            ],
          }),
      }) as unknown as typeof global.fetch;

      const res = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/upstream-keys/discover-models',
        headers: { cookie: rig.cookie },
        payload: {
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
          providerType: 'openai_compatible',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ realName: string; publicName: string }> };
      expect(body.items).toHaveLength(2);
      expect(body.items[0]).toMatchObject({
        realName: 'model-a',
        publicName: 'model-a',
        endpointProtocol: 'openai',
        endpointProviderType: 'openai_compatible',
        endpointBaseUrl: 'https://api.example.com',
      });
      expect(body.items[1]).toMatchObject({
        realName: 'model-b',
        publicName: 'model-b',
        endpointProtocol: 'openai',
        endpointProviderType: 'openai_compatible',
        endpointBaseUrl: 'https://api.example.com',
      });
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      expect(calls[0]?.[0]).toBe('https://api.example.com/v1/models');
      expect((calls[0]?.[1] as { headers: Record<string, string> }).headers.authorization).toBe(
        'Bearer sk-test',
      );
    });

    it('prefers the OpenAI-compatible endpoint from a preset for discovery', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M2' }],
          }),
      }) as unknown as typeof global.fetch;

      const res = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/upstream-keys/discover-models',
        headers: { cookie: rig.cookie },
        payload: {
          // The frontend may send the Anthropic endpoint; the backend should
          // switch to the OpenAI-compatible endpoint for /v1/models.
          baseUrl: 'https://api.minimaxi.com/anthropic',
          apiKey: 'sk-test',
          providerType: 'anthropic_compatible',
          providerPresetId: 'minimax',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ realName: string; publicName: string }> };
      expect(body.items).toHaveLength(2);
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      expect(calls[0]?.[0]).toBe('https://api.minimaxi.com/v1/models');
      expect((calls[0]?.[1] as { headers: Record<string, string> }).headers.authorization).toBe(
        'Bearer sk-test',
      );
    });

    it('returns model-level endpoint overrides for OpenCode Go discovery', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [{ id: 'deepseek-v4-flash' }, { id: 'qwen3.7-plus' }],
          }),
      }) as unknown as typeof global.fetch;

      const res = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/upstream-keys/discover-models',
        headers: { cookie: rig.cookie },
        payload: {
          baseUrl: 'https://opencode.ai/zen/go',
          apiKey: 'sk-test',
          providerType: 'openai_compatible',
          providerPresetId: 'opencode-go',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{
          realName: string;
          endpointProtocol: string;
          endpointProviderType: string;
          endpointBaseUrl: string;
        }>;
      };
      expect(body.items).toEqual([
        {
          realName: 'deepseek-v4-flash',
          publicName: 'deepseek-v4-flash',
          endpointProtocol: 'openai',
          endpointProviderType: 'openai_compatible',
          endpointBaseUrl: 'https://opencode.ai/zen/go',
        },
        {
          realName: 'qwen3.7-plus',
          publicName: 'qwen3.7-plus',
          endpointProtocol: 'anthropic',
          endpointProviderType: 'anthropic_compatible',
          endpointBaseUrl: 'https://opencode.ai/zen/go',
        },
      ]);
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      expect(calls[0]?.[0]).toBe('https://opencode.ai/zen/go/v1/models');
    });

    it('returns 502 when upstream fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      }) as unknown as typeof global.fetch;

      const res = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/upstream-keys/discover-models',
        headers: { cookie: rig.cookie },
        payload: {
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-bad',
          providerType: 'openai_compatible',
        },
      });
      expect(res.statusCode).toBe(502);
      const body = res.json() as { error: { message: string } };
      expect(body.error.message).toContain('401');
    });
  });
});

describe('upstream key sticky session TTL', () => {
  let rig: AdminTestRig;
  beforeEach(async () => {
    rig = await makeAdminRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('creates an upstream key with a custom sticky session TTL', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'sticky-ttl-create',
        providerType: 'anthropic_compatible',
        baseUrl: 'https://x.com',
        apiKey: 'k',
        stickySessionTtlMs: 120_000,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { stickySessionTtlMs: number };
    expect(body.stickySessionTtlMs).toBe(120_000);

    const row = await rig.db
      .select()
      .from(upstreamKeys)
      .where(eq(upstreamKeys.name, 'sticky-ttl-create'))
      .get();
    expect(row).toBeTruthy();
    expect(row!.stickySessionTtlMs).toBe(120_000);
  });

  it('updates the sticky session TTL via PATCH', async () => {
    const create = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'sticky-ttl-patch',
        providerType: 'anthropic_compatible',
        baseUrl: 'https://x.com',
        apiKey: 'k',
      },
    });
    expect(create.statusCode).toBe(200);
    const id = (create.json() as { id: string }).id;

    const patch = await rig.app.inject({
      method: 'PATCH',
      url: `/api/admin/upstream-keys/${id}`,
      headers: { cookie: rig.cookie },
      payload: { stickySessionTtlMs: 60_000 },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { stickySessionTtlMs: number }).stickySessionTtlMs).toBe(60_000);

    const row = await rig.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    expect(row!.stickySessionTtlMs).toBe(60_000);
  });
});
