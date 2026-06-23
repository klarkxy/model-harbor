import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeAdminRig, type AdminTestRig } from './helper.js';

describe('admin settings routes', () => {
  let rig: AdminTestRig;
  beforeEach(async () => {
    rig = await makeAdminRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('GET /api/admin/settings returns defaults', async () => {
    const res = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: { cookie: rig.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.circuitBreaker).toBeTruthy();
    expect(body.endpointHealth).toBeTruthy();
    expect(body.contentLogging).toBeTruthy();
    expect(body.modelReference.autoPreset).toBe('balanced');
    expect(body.modelReference.autoTopN).toBe(5);
  });

  it('PUT /api/admin/settings updates circuit breaker knobs (clamped to floor)', async () => {
    const res = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { cookie: rig.cookie },
      payload: {
        circuitBreaker: {
          enabled: false,
          failureThreshold: 0, // clamped to 1
          baseCooldownMs: 10, // clamped to 1000
          maxCooldownMs: 5, // clamped to 1000
          halfOpenSuccessCount: 0, // clamped to 1
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.circuitBreaker.enabled).toBe(false);
    expect(body.circuitBreaker.failureThreshold).toBe(1);
    expect(body.circuitBreaker.baseCooldownMs).toBe(1000);
    expect(body.circuitBreaker.maxCooldownMs).toBe(1000);
    expect(body.circuitBreaker.halfOpenSuccessCount).toBe(1);
  });

  it('PUT /api/admin/settings updates endpoint health + streaming knobs', async () => {
    const res = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { cookie: rig.cookie },
      payload: {
        endpointHealth: {
          probeEnabled: true,
          probeIntervalMs: 60_000,
          probeTimeoutMs: 1_000,
          degradedLatencyMs: 1_000,
        },
        streaming: { firstTokenTimeoutMs: 5000 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.endpointHealth.probeEnabled).toBe(true);
    expect(body.endpointHealth.probeIntervalMs).toBe(60_000);
    expect(body.streaming.firstTokenTimeoutMs).toBe(5000);
  });

  it('PUT /api/admin/settings updates content logging', async () => {
    const res = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { cookie: rig.cookie },
      payload: {
        contentLogging: { enabled: true, retentionDays: 30, maxPayloadBytes: 4096 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.contentLogging.enabled).toBe(true);
    expect(body.contentLogging.retentionDays).toBe(30);
    expect(body.contentLogging.maxPayloadBytes).toBe(4096);
  });

  it('PUT /api/admin/settings updates model reference preset/weights/topN', async () => {
    const res = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { cookie: rig.cookie },
      payload: {
        modelReference: {
          autoPreset: 'code',
          autoWeights: { chat: 0.5, total: 0.5 },
          autoTopN: 10,
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.modelReference.autoPreset).toBe('code');
    expect(body.modelReference.autoTopN).toBe(10);
    // Weights are normalized to sum to 1; just sanity-check shape.
    const weights = body.modelReference.autoWeights as Record<string, number>;
    expect(typeof weights.chat).toBe('number');
    expect(typeof weights.intelligence).toBe('number');
  });

  it('PUT /api/admin/settings rejects invalid autoPreset silently (keeps previous)', async () => {
    const res = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { cookie: rig.cookie },
      payload: {
        modelReference: { autoPreset: 'invalid-preset' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.modelReference.autoPreset).toBe('balanced');
  });

  it('PUT /api/admin/settings clamps autoTopN to [1, 20]', async () => {
    const tooBig = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { cookie: rig.cookie },
      payload: { modelReference: { autoTopN: 999 } },
    });
    expect(tooBig.json().modelReference.autoTopN).toBe(20);

    const tooSmall = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { cookie: rig.cookie },
      payload: { modelReference: { autoTopN: -5 } },
    });
    expect(tooSmall.json().modelReference.autoTopN).toBe(1);
  });

  it('GET /api/admin/circuit-breakers lists breakers and filters by state', async () => {
    const res = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/circuit-breakers',
      headers: { cookie: rig.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('GET /api/admin/circuit-breakers with state=closed returns empty list', async () => {
    const res = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/circuit-breakers?state=closed',
      headers: { cookie: rig.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  it('POST /api/admin/circuit-breakers/:id/reset returns 404 for unknown id', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/circuit-breakers/cb_unknown/reset',
      headers: { cookie: rig.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
