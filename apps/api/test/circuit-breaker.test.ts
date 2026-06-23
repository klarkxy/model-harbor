// Circuit breaker tests (M9).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import {
  circuitBreakers,
  requestTraceLogs,
} from '../src/modules/db/index.js';
import { makeGatewayRig, type GatewayTestRig } from './gateway-helper.js';
import { makeAdminRig, type AdminTestRig } from './helper.js';

const ANTHROPIC_BODY = {
  model: 'coding-fast',
  max_tokens: 10,
  messages: [{ role: 'user', content: 'hi' }],
};

function anthropicHeader(rawKey: string) {
  return { authorization: `Bearer ${rawKey}`, 'content-type': 'application/json' };
}

describe('circuit breaker core', () => {
  let rig: GatewayTestRig;
  beforeEach(async () => {
    rig = await makeGatewayRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('opens after the configured failure threshold and closes after half-open successes', async () => {
    const { recordCircuitBreakerFailure, recordCircuitBreakerSuccess, isCircuitBreakerOpen } = await import(
      '../src/modules/router/circuit-breaker.js'
    );
    const settings = {
      circuitBreakerEnabled: true,
      circuitBreakerFailureThreshold: 3,
      circuitBreakerBaseCooldownMs: 1000,
      circuitBreakerMaxCooldownMs: 5000,
      circuitBreakerHalfOpenSuccessCount: 2,
    };
    const error = {
      category: 'provider_rate_limit' as const,
      providerCode: 'rate_limit_error',
      providerMessage: 'too many',
      upstreamStatus: 429,
    };

    for (let i = 0; i < 3; i++) {
      const tx = await recordCircuitBreakerFailure(rig.db, {
        upstreamKeyId: rig.upstreamKeyId,
        realModelName: 'fake-real-model',
        error,
        now: new Date(),
        settings,
      });
      if (i < 2) expect(tx).toBeNull();
      if (i === 2) expect(tx?.newState).toBe('open');
    }

    const openNow = await isCircuitBreakerOpen(rig.db, {
      upstreamKeyId: rig.upstreamKeyId,
      realModelName: 'fake-real-model',
      now: new Date(),
      settings,
    });
    expect(openNow).toBe(true);

    // Simulate cooldown elapsed -> half_open.
    const rows = await rig.db
      .select()
      .from(circuitBreakers)
      .where(and(eq(circuitBreakers.upstreamKeyId, rig.upstreamKeyId), eq(circuitBreakers.realModelName, 'fake-real-model')))
      .all();
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    const afterCooldown = new Date((row.cooldownUntil?.getTime() ?? Date.now()) + 1);
    const halfOpen = await isCircuitBreakerOpen(rig.db, {
      upstreamKeyId: rig.upstreamKeyId,
      realModelName: 'fake-real-model',
      now: afterCooldown,
      settings,
    });
    expect(halfOpen).toBe(false);

    const rowAfterHalfOpen = await rig.db
      .select()
      .from(circuitBreakers)
      .where(eq(circuitBreakers.id, row.id))
      .get();
    expect(rowAfterHalfOpen?.state).toBe('half_open');

    // Two successes close the breaker.
    for (let i = 0; i < 2; i++) {
      const tx = await recordCircuitBreakerSuccess(rig.db, {
        upstreamKeyId: rig.upstreamKeyId,
        realModelName: 'fake-real-model',
        now: new Date(),
        settings,
      });
      if (i === 1) expect(tx?.newState).toBe('closed');
    }

    const closed = await rig.db.select().from(circuitBreakers).where(eq(circuitBreakers.id, row.id)).get();
    expect(closed?.state).toBe('closed');
  });
});

describe('circuit breaker gateway integration', () => {
  let rig: GatewayTestRig;
  beforeEach(async () => {
    rig = await makeGatewayRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('opens the breaker after 5 consecutive failures and skips the candidate', async () => {
    // Use model_not_found (404) so the upstream is not put into cooldown,
    // allowing the circuit breaker to accumulate all 5 failures on the same
    // (upstream key, real model) pair.
    for (let i = 0; i < 5; i++) {
      rig.fake.enqueueAnthropicResponse({
        status: 404,
        body: {
          type: 'error',
          error: { type: 'model_not_found', message: 'model not found' },
        },
      });
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
      expect(res.statusCode).toBe(502);
    }

    const row = await rig.db
      .select()
      .from(circuitBreakers)
      .where(and(eq(circuitBreakers.upstreamKeyId, rig.upstreamKeyId), eq(circuitBreakers.realModelName, 'fake-real-model')))
      .get();
    expect(row?.state).toBe('open');

    // 6th request sees no available upstream because the only candidate is open.
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: anthropicHeader(rig.rawConsumerKey),
      payload: ANTHROPIC_BODY,
    });
    expect(res.statusCode).toBe(503);
    // The candidate was filtered by the circuit breaker so no upstream was attempted.
    expect(res.body).toContain('no available upstream');

    // Trace logs contain circuit_breaker_open.
    const traces = await rig.db
      .select()
      .from(requestTraceLogs)
      .where(eq(requestTraceLogs.step, 'circuit_breaker_open'))
      .all();
    expect(traces.length).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('allows traffic again once the breaker transitions to half_open', async () => {
    for (let i = 0; i < 5; i++) {
      rig.fake.enqueueAnthropicResponse({
        status: 404,
        body: {
          type: 'error',
          error: { type: 'model_not_found', message: 'model not found' },
        },
      });
      await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
    }

    const row = await rig.db
      .select()
      .from(circuitBreakers)
      .where(and(eq(circuitBreakers.upstreamKeyId, rig.upstreamKeyId), eq(circuitBreakers.realModelName, 'fake-real-model')))
      .get();
    expect(row?.state).toBe('open');

    // Force cooldown to elapsed.
    await rig.db
      .update(circuitBreakers)
      .set({ cooldownUntil: new Date(Date.now() - 1) })
      .where(eq(circuitBreakers.id, row!.id))
      .run();

    rig.fake.enqueueAnthropicResponse({
      body: {
        id: 'msg_recover',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'recovered' }],
        model: 'fake-real-model',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });

    // First success after cooldown should be accepted and transition to half_open.
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: anthropicHeader(rig.rawConsumerKey),
      payload: ANTHROPIC_BODY,
    });
    expect(res.statusCode).toBe(200);

    const rowAfter = await rig.db.select().from(circuitBreakers).where(eq(circuitBreakers.id, row!.id)).get();
    expect(rowAfter?.state).toBe('half_open');
  }, 15_000);
});

describe('circuit breaker admin API', () => {
  let rig: AdminTestRig;
  beforeEach(async () => {
    rig = await makeAdminRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('returns and updates circuit breaker settings', async () => {
    const get = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: { cookie: rig.cookie },
    });
    expect(get.statusCode).toBe(200);
    const body = get.json() as {
      circuitBreaker: { enabled: boolean; failureThreshold: number };
      streaming: { firstTokenTimeoutMs: number };
    };
    expect(body.circuitBreaker.enabled).toBe(true);
    expect(body.circuitBreaker.failureThreshold).toBe(5);
    expect(body.streaming.firstTokenTimeoutMs).toBe(15_000);

    const put = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { cookie: rig.cookie, 'content-type': 'application/json' },
      payload: { circuitBreaker: { failureThreshold: 3, baseCooldownMs: 2000 }, streaming: { firstTokenTimeoutMs: 5_000 } },
    });
    expect(put.statusCode).toBe(200);
    const updated = put.json() as typeof body;
    expect(updated.circuitBreaker.failureThreshold).toBe(3);
    expect(updated.circuitBreaker.baseCooldownMs).toBe(2000);
    expect(updated.streaming.firstTokenTimeoutMs).toBe(5_000);
  });

  it('resets a circuit breaker via admin API', async () => {
    const { recordCircuitBreakerFailure } = await import('../src/modules/router/circuit-breaker.js');
    const settings = {
      circuitBreakerEnabled: true,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerBaseCooldownMs: 60_000,
      circuitBreakerMaxCooldownMs: 600_000,
      circuitBreakerHalfOpenSuccessCount: 2,
    };

    // Seed an upstream key so we can create a breaker row.
    const { encryptUpstreamApiKey } = await import('../src/modules/admin/index.js');
    const { upstreamKeys } = await import('../src/modules/db/index.js');
    const now = new Date();
    const enc = encryptUpstreamApiKey('sk-test', 'test-secret-key-for-m4');
    await rig.db.insert(upstreamKeys).values({
      id: 'uk_test_breaker',
      name: 'Test breaker key',
      providerType: 'anthropic_compatible',
      baseUrl: 'http://localhost:1',
      apiKeyCiphertext: enc.ciphertext,
      apiKeyPrefix: enc.prefix,
      supportedModelsJson: JSON.stringify(['model-a']),
      enabled: true,
      frozen: false,
      createdAt: now,
      updatedAt: now,
    });

    await recordCircuitBreakerFailure(rig.db, {
      upstreamKeyId: 'uk_test_breaker',
      realModelName: 'model-a',
      error: {
        category: 'provider_rate_limit',
        providerCode: 'rate_limit_error',
        providerMessage: 'too many',
        upstreamStatus: 429,
      },
      now,
      settings,
    });

    const row = await rig.db
      .select()
      .from(circuitBreakers)
      .where(and(eq(circuitBreakers.upstreamKeyId, 'uk_test_breaker'), eq(circuitBreakers.realModelName, 'model-a')))
      .get();
    expect(row?.state).toBe('open');

    const reset = await rig.app.inject({
      method: 'POST',
      url: `/api/admin/circuit-breakers/${row!.id}/reset`,
      headers: { cookie: rig.cookie },
    });
    expect(reset.statusCode).toBe(200);

    const after = await rig.db.select().from(circuitBreakers).where(eq(circuitBreakers.id, row!.id)).get();
    expect(after?.state).toBe('closed');
  });
});
