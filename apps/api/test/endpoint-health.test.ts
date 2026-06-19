import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { upstreamKeys, upstreamEndpointHealth } from '../src/modules/db/index.js';
import { makeAdminRig, type AdminTestRig } from './helper.js';
import {
  listEndpointTargetsForKey,
  pruneOrphanEndpointHealth,
  runEndpointHealthProbe,
  sortCandidatesByLatency,
} from '../src/modules/upstream/endpoint-health.js';
import { updateCircuitBreakerSettings } from '../src/modules/router/circuit-breaker.js';
import { seedFullRoute } from './helper.js';

const originalFetch = globalThis.fetch;

describe('upstream endpoint health', () => {
  let rig: AdminTestRig;

  beforeEach(async () => {
    rig = await makeAdminRig();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rig.close();
  });

  async function createKey(payload: {
    name: string;
    providerType: 'anthropic_compatible' | 'openai_compatible';
    baseUrl: string;
    apiKey: string;
    endpoints?: Array<{ protocol: string; baseUrl: string; providerType: string }>;
  }): Promise<string> {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie },
      payload,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { id: string }).id;
  }

  it('lists one endpoint target for a single-endpoint key', async () => {
    const id = await createKey({
      name: 'single',
      providerType: 'anthropic_compatible',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
    });
    const row = await rig.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    const targets = listEndpointTargetsForKey(row!);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ upstreamKeyId: id, baseUrl: 'https://api.example.com' });
  });

  it('lists distinct endpoint targets from endpointsJson', async () => {
    const id = await createKey({
      name: 'multi',
      providerType: 'anthropic_compatible',
      baseUrl: 'https://legacy.example.com',
      apiKey: 'sk-test',
      endpoints: [
        { protocol: 'anthropic', baseUrl: 'https://anthropic.example.com', providerType: 'anthropic_compatible' },
        { protocol: 'openai', baseUrl: 'https://openai.example.com', providerType: 'openai_compatible' },
        { protocol: 'openai', baseUrl: 'https://openai.example.com', providerType: 'openai_compatible' },
      ],
    });
    const row = await rig.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).get();
    const targets = listEndpointTargetsForKey(row!);
    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.baseUrl).sort()).toEqual([
      'https://anthropic.example.com',
      'https://openai.example.com',
    ]);
  });

  it('probes enabled keys and stores delay/degraded state', async () => {
    await createKey({
      name: 'healthy',
      providerType: 'anthropic_compatible',
      baseUrl: 'https://healthy.example.com',
      apiKey: 'sk-test',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200 } as Response),
    );

    const summary = await runEndpointHealthProbe(rig.db, rig.secretKey);
    expect(summary.checked).toBe(1);
    expect(summary.degraded).toBe(0);

    const rows = await rig.db.select().from(upstreamEndpointHealth).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      endpointBaseUrl: 'https://healthy.example.com',
      degraded: false,
      errorCode: null,
    });
    expect(typeof rows[0].delayMs).toBe('number');
  });

  it('marks an endpoint degraded when it returns a 5xx', async () => {
    await createKey({
      name: 'unhealthy',
      providerType: 'anthropic_compatible',
      baseUrl: 'https://unhealthy.example.com',
      apiKey: 'sk-test',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 503 } as Response),
    );

    const summary = await runEndpointHealthProbe(rig.db, rig.secretKey);
    expect(summary.checked).toBe(1);
    expect(summary.degraded).toBe(1);

    const row = await rig.db.select().from(upstreamEndpointHealth).get();
    expect(row).toMatchObject({
      degraded: true,
      errorCode: 'HTTP_503',
    });
  });

  it('marks an endpoint degraded on transport failure', async () => {
    await createKey({
      name: 'down',
      providerType: 'anthropic_compatible',
      baseUrl: 'https://down.example.com',
      apiKey: 'sk-test',
    });

    const error = new TypeError('fetch failed');
    (error as { name: string }).name = 'TypeError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));

    const summary = await runEndpointHealthProbe(rig.db, rig.secretKey);
    expect(summary.checked).toBe(1);
    expect(summary.degraded).toBe(1);

    const row = await rig.db.select().from(upstreamEndpointHealth).get();
    expect(row).toMatchObject({
      degraded: true,
      delayMs: null,
    });
    expect(row?.errorMessage).toContain('fetch failed');
  });

  it('exposes endpoint health via the admin API', async () => {
    const id = await createKey({
      name: 'api',
      providerType: 'anthropic_compatible',
      baseUrl: 'https://api-health.example.com',
      apiKey: 'sk-test',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200 } as Response),
    );
    await runEndpointHealthProbe(rig.db, rig.secretKey);

    const res = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/upstream-endpoint-health',
      headers: { cookie: rig.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ upstreamKeyId: string; endpointBaseUrl: string; degraded: boolean }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      upstreamKeyId: id,
      endpointBaseUrl: 'https://api-health.example.com',
      degraded: false,
    });

    const filtered = await rig.app.inject({
      method: 'GET',
      url: `/api/admin/upstream-endpoint-health?upstreamKeyId=${id}`,
      headers: { cookie: rig.cookie },
    });
    expect(filtered.json()).toEqual(body);
  });

  it('sorts candidates by degraded=false then delay ascending', () => {
    const candidates = [
      { upstreamKeyId: 'a', endpointBaseUrl: 'https://a', priority: 1, weight: 1 },
      { upstreamKeyId: 'b', endpointBaseUrl: 'https://b', priority: 1, weight: 1 },
      { upstreamKeyId: 'c', endpointBaseUrl: 'https://c', priority: 1, weight: 1 },
    ];
    const health = [
      { id: 'h1', upstreamKeyId: 'a', endpointBaseUrl: 'https://a', delayMs: 100, lastCheckedAt: new Date(), degraded: false, errorCode: null, errorMessage: null, createdAt: new Date(), updatedAt: new Date() },
      { id: 'h2', upstreamKeyId: 'b', endpointBaseUrl: 'https://b', delayMs: 50, lastCheckedAt: new Date(), degraded: false, errorCode: null, errorMessage: null, createdAt: new Date(), updatedAt: new Date() },
      { id: 'h3', upstreamKeyId: 'c', endpointBaseUrl: 'https://c', delayMs: 10, lastCheckedAt: new Date(), degraded: true, errorCode: 'HTTP_500', errorMessage: 'down', createdAt: new Date(), updatedAt: new Date() },
    ];
    const sorted = sortCandidatesByLatency(candidates, health);
    expect(sorted.map((c) => c.upstreamKeyId)).toEqual(['b', 'a', 'c']);
  });

  it('falls back to priority and weight when no health row exists', () => {
    const candidates = [
      { upstreamKeyId: 'a', endpointBaseUrl: 'https://a', priority: 2, weight: 5 },
      { upstreamKeyId: 'b', endpointBaseUrl: 'https://b', priority: 1, weight: 1 },
    ];
    const sorted = sortCandidatesByLatency(candidates, []);
    expect(sorted.map((c) => c.upstreamKeyId)).toEqual(['b', 'a']);
  });

  it('cleans up orphan endpoint health rows when the upstream key is deleted', async () => {
    const id = await createKey({
      name: 'orphan',
      providerType: 'anthropic_compatible',
      baseUrl: 'https://orphan.example.com',
      apiKey: 'sk-test',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 } as Response));
    await runEndpointHealthProbe(rig.db, rig.secretKey);
    expect(await rig.db.select().from(upstreamEndpointHealth).all()).toHaveLength(1);

    const del = await rig.app.inject({
      method: 'DELETE',
      url: `/api/admin/upstream-keys/${id}`,
      headers: { cookie: rig.cookie },
    });
    expect(del.statusCode).toBe(200);
    expect(await rig.db.select().from(upstreamEndpointHealth).all()).toHaveLength(0);
  });

  it('prunes orphan rows when the endpoint is no longer configured', async () => {
    const id = await createKey({
      name: 'prune',
      providerType: 'anthropic_compatible',
      baseUrl: 'https://prune.example.com',
      apiKey: 'sk-test',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 } as Response));
    await runEndpointHealthProbe(rig.db, rig.secretKey);
    expect(await rig.db.select().from(upstreamEndpointHealth).all()).toHaveLength(1);

    // Change the key's base URL so the existing health row becomes orphaned.
    await rig.app.inject({
      method: 'PATCH',
      url: `/api/admin/upstream-keys/${id}`,
      headers: { cookie: rig.cookie, 'content-type': 'application/json' },
      payload: { baseUrl: 'https://prune-new.example.com' },
    });

    const removed = await pruneOrphanEndpointHealth(rig.db);
    expect(removed).toBe(1);
    expect(await rig.db.select().from(upstreamEndpointHealth).all()).toHaveLength(0);
  });

  it('skips probing when disabled in admin settings', async () => {
    await createKey({
      name: 'disabled',
      providerType: 'anthropic_compatible',
      baseUrl: 'https://disabled.example.com',
      apiKey: 'sk-test',
    });

    const fetchMock = vi.fn().mockResolvedValue({ status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    await updateCircuitBreakerSettings(rig.db, { endpointHealthProbeEnabled: false });

    const summary = await runEndpointHealthProbe(rig.db, rig.secretKey);
    expect(summary.checked).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects configured probe interval from admin settings', async () => {
    const id = await createKey({
      name: 'interval',
      providerType: 'anthropic_compatible',
      baseUrl: 'https://interval.example.com',
      apiKey: 'sk-test',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 } as Response));
    await updateCircuitBreakerSettings(rig.db, { endpointHealthProbeIntervalMs: 60_000 });

    const first = await runEndpointHealthProbe(rig.db, rig.secretKey);
    expect(first.checked).toBe(1);

    const second = await runEndpointHealthProbe(rig.db, rig.secretKey, new Date(Date.now() + 1000));
    expect(second.checked).toBe(0);

    // Simulate the interval elapsing by moving the existing row back in time.
    await rig.db
      .update(upstreamEndpointHealth)
      .set({ lastCheckedAt: new Date(Date.now() - 120_000) })
      .where(eq(upstreamEndpointHealth.upstreamKeyId, id));
    const third = await runEndpointHealthProbe(rig.db, rig.secretKey);
    expect(third.checked).toBe(1);
  });

  it('exposes and updates endpoint health settings via admin settings API', async () => {
    const get = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: { cookie: rig.cookie },
    });
    expect(get.statusCode).toBe(200);
    const body = get.json() as {
      endpointHealth: { probeEnabled: boolean; probeIntervalMs: number; probeTimeoutMs: number; degradedLatencyMs: number };
    };
    expect(body.endpointHealth.probeEnabled).toBe(true);
    expect(body.endpointHealth.probeTimeoutMs).toBe(10_000);
    expect(body.endpointHealth.degradedLatencyMs).toBe(5_000);

    const put = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { cookie: rig.cookie, 'content-type': 'application/json' },
      payload: { endpointHealth: { probeIntervalMs: 120_000, probeTimeoutMs: 3_000, degradedLatencyMs: 2_000 } },
    });
    expect(put.statusCode).toBe(200);
    const updated = put.json() as typeof body;
    expect(updated.endpointHealth.probeIntervalMs).toBe(120_000);
    expect(updated.endpointHealth.probeTimeoutMs).toBe(3_000);
    expect(updated.endpointHealth.degradedLatencyMs).toBe(2_000);
  });

  it('gateway prefers the lower-latency candidate', async () => {
    const refs = await seedFullRoute(rig);

    const fastRes = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      headers: { cookie: rig.cookie, 'content-type': 'application/json' },
      payload: {
        name: 'fast-upstream',
        providerType: 'anthropic_compatible',
        baseUrl: 'https://fast.example.com',
        apiKey: 'sk-test',
        modelMappings: [{ realName: 'ds-v4-flash', publicName: 'ds-v4-flash', enabled: true }],
      },
    });
    expect(fastRes.statusCode).toBe(200);
    const fastId = (fastRes.json() as { id: string }).id;

    const candidatesRes = await rig.app.inject({
      method: 'PUT',
      url: `/api/admin/public-models/${refs.publicModelId}/candidates`,
      headers: { cookie: rig.cookie, 'content-type': 'application/json' },
      payload: {
        candidates: [
          { upstreamKeyId: refs.upstreamKeyId, realModelName: 'ds-v4-flash', priority: 100, weight: 1, enabled: true },
          { upstreamKeyId: fastId, realModelName: 'ds-v4-flash', priority: 100, weight: 1, enabled: true },
        ],
      },
    });
    expect(candidatesRes.statusCode).toBe(200);

    const now = new Date();
    await rig.db.insert(upstreamEndpointHealth).values([
      {
        id: 'eh_slow',
        upstreamKeyId: refs.upstreamKeyId,
        endpointBaseUrl: 'https://api.example.com',
        delayMs: 500,
        lastCheckedAt: now,
        degraded: false,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'eh_fast',
        upstreamKeyId: fastId,
        endpointBaseUrl: 'https://fast.example.com',
        delayMs: 20,
        lastCheckedAt: now,
        degraded: false,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    let chosenUrl: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        chosenUrl = url;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'msg_fast',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'fast' }],
              model: 'ds-v4-flash',
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }),
    );

    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${refs.rawConsumerKey}`, 'content-type': 'application/json' },
      payload: {
        model: 'ds-v4-flash',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 10,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(chosenUrl).toBe('https://fast.example.com/v1/messages');
  });
});
