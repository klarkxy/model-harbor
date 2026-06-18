import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { publicModelCandidates, publicModels, upstreamKeys } from '../src/modules/db/index.js';
import { decryptUpstreamApiKeyForTest } from '../src/modules/admin/index.js';
import { makeAdminRig, type AdminTestRig } from './helper.js';

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
      expect(body.items[0]).toEqual({ realName: 'model-a', publicName: 'model-a' });
      expect(body.items[1]).toEqual({ realName: 'model-b', publicName: 'model-b' });
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
