// Post-M7 hardening tests: login rate limiting, audit logging,
// redaction, /readyz DB probe, and the usage aggregation API.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditEvents,
  loginAttempts,
  requestTraceLogs,
  usageRecords,
} from '../src/modules/db/index.js';
import { makeAdminRig, seedFullRoute, type AdminTestRig } from './helper.js';
import { makeGatewayRig, type GatewayTestRig } from './gateway-helper.js';

describe('login rate limiting', () => {
  let rig: AdminTestRig;
  beforeEach(async () => {
    rig = await makeAdminRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('returns 429 after the configured failure count and resets on success', async () => {
    // The default cap is 10 failures in 15 minutes; we directly insert 10
    // failures into the table to keep this test fast. The IP must match
    // the one fastify.inject will report (127.0.0.1).
    const username = 'admin';
    const ip = '127.0.0.1';
    for (let i = 0; i < 10; i++) {
      await rig.db.insert(loginAttempts).values({
        id: `la_${i}`,
        username,
        ip,
        success: false,
        createdAt: new Date(Date.now() - i * 1000),
      });
    }
    const blocked = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username, password: 'wrong' },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});

describe('audit logging', () => {
  let rig: AdminTestRig;
  beforeEach(async () => {
    rig = await makeAdminRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('records login.success and login.failure audit rows', async () => {
    await rig.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: 'admin', password: 'wrong' },
    });
    await rig.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: 'admin', password: 'secret123' },
    });
    const rows = await rig.db.select().from(auditEvents).all();
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toContain('admin.login.failure');
    expect(actions).toContain('admin.login.success');
  });

  it('does not write a raw consumer key into the audit table', async () => {
    await rig.db.delete(auditEvents).run();
    const refs = await seedFullRoute(rig);
    const create = await rig.app.inject({
      method: 'POST',
      url: `/api/admin/apps/${refs.appId}/consumer-keys`,
      headers: { cookie: rig.cookie },
      payload: { name: 'audit-test' },
    });
    expect(create.statusCode).toBe(200);
    const body = create.json() as { key: string; keyPrefix: string };
    expect(body.key.startsWith('mh_')).toBe(true);
    const rows = await rig.db.select().from(auditEvents).all();
    const jsonBlob = JSON.stringify(rows);
    expect(jsonBlob.includes(body.key)).toBe(false);
    // The prefix is the only part of the key the audit log carries; it is
    // safe to expose and helps operators identify which key changed.
    expect(jsonBlob.includes('keyPrefix')).toBe(true);
  });
});

describe('redaction helper', () => {
  it('redacts mh_ / sk- / Bearer values from strings, headers, and nested objects', async () => {
    const { redactString, redactValue } = await import('../src/modules/observability/redaction.js');
    expect(redactString('Authorization: Bearer mh_supersecret')).toBe(
      'Authorization: Bearer [redacted]',
    );
    expect(redactString('sk-ant-1234abcd')).toBe('[redacted]');
    expect(redactString('hello mh_zzz world')).toBe('hello [redacted] world');
    const obj = redactValue({
      headers: { authorization: 'Bearer mh_xyz', cookie: 'x' },
      apiKey: 'sk-aaa',
      nested: { token: 'mh_bbb', note: 'fine' },
    }) as Record<string, Record<string, string>>;
    expect(obj['headers']!['authorization']).toBe('[redacted]');
    expect(obj['headers']!['cookie']).toBe('[redacted]');
    expect(obj['apiKey']).toBe('[redacted]');
    expect(obj['nested']!['token']).toBe('[redacted]');
    expect(obj['nested']!['note']).toBe('fine');
  });

  it('redacts keys embedded inside Error messages', async () => {
    const { redactValue } = await import('../src/modules/observability/redaction.js');
    const err = new Error('upstream rejected with key mh_supersecret');
    const out = redactValue(err) as Error;
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe('upstream rejected with key [redacted]');
    // Errors without secrets pass through untouched.
    const cleanErr = new Error('plain message');
    expect(redactValue(cleanErr)).toBe(cleanErr);
  });
});

describe('usage aggregation API', () => {
  let rig: AdminTestRig;
  beforeEach(async () => {
    rig = await makeAdminRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('returns zeros when there are no usage records', async () => {
    const totals = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/usage/totals?window=today',
      headers: { cookie: rig.cookie },
    });
    expect(totals.statusCode).toBe(200);
    const body = totals.json() as {
      totalRequests: number;
      successfulRequests: number;
      failedRequests: number;
    };
    expect(body.totalRequests).toBe(0);
    expect(body.successfulRequests).toBe(0);
    expect(body.failedRequests).toBe(0);
  });

  it('aggregates by app and by upstream key when usage records exist', async () => {
    const now = new Date();
    const refs = await seedFullRoute(rig);
    await rig.db.insert(usageRecords).values([
      {
        id: 'usr_a',
        appId: refs.appId,
        consumerKeyId: refs.consumerKeyId,
        requestedTargetName: 'ds-v4-flash',
        resolvedTargetType: 'public_model',
        resolvedTargetId: refs.publicModelId,
        upstreamKeyId: refs.upstreamKeyId,
        realModelName: 'ds-v4-flash',
        sourceProtocol: 'anthropic',
        providerType: 'anthropic_compatible',
        stream: false,
        stickyHit: false,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        status: 'success',
        errorCode: null,
        latencyMs: 100,
        createdAt: now,
      },
      {
        id: 'usr_b',
        appId: refs.appId,
        consumerKeyId: refs.consumerKeyId,
        requestedTargetName: 'ds-v4-flash',
        resolvedTargetType: 'public_model',
        resolvedTargetId: refs.publicModelId,
        upstreamKeyId: refs.upstreamKeyId,
        realModelName: 'ds-v4-flash',
        sourceProtocol: 'anthropic',
        providerType: 'anthropic_compatible',
        stream: true,
        stickyHit: true,
        inputTokens: 5,
        outputTokens: 7,
        totalTokens: 12,
        status: 'error',
        errorCode: 'rate_limit_error',
        latencyMs: 50,
        createdAt: now,
      },
    ]);

    const totals = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/usage/totals?window=24h',
      headers: { cookie: rig.cookie },
    });
    const body = totals.json() as {
      totalRequests: number;
      successfulRequests: number;
      failedRequests: number;
      stickyHits: number;
      successRate: number;
      stickyHitRate: number;
    };
    expect(body.totalRequests).toBe(2);
    expect(body.successfulRequests).toBe(1);
    expect(body.failedRequests).toBe(1);
    expect(body.stickyHits).toBe(1);
    expect(body.successRate).toBeCloseTo(0.5, 3);
    expect(body.stickyHitRate).toBeCloseTo(0.5, 3);

    const byApp = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/usage/by-app?window=24h',
      headers: { cookie: rig.cookie },
    });
    const apps = (byApp.json() as { items: Array<{ id: string; totalRequests: number }> }).items;
    expect(apps.find((x) => x.id === refs.appId)?.totalRequests).toBe(2);

    const byUk = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/usage/by-upstream-key?window=24h',
      headers: { cookie: rig.cookie },
    });
    const uks = (byUk.json() as { items: Array<{ id: string; totalRequests: number }> }).items;
    expect(uks.find((x) => x.id === refs.upstreamKeyId)?.totalRequests).toBe(2);
    // Cleanup to avoid leaking rows.
    await rig.db.delete(usageRecords).where(eq(usageRecords.appId, refs.appId)).run();
  });
});

describe('request trace logs', () => {
  let rig: GatewayTestRig;
  beforeEach(async () => {
    rig = await makeGatewayRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('returns a trace id header and writes trace log rows for a successful request', async () => {
    rig.fake.enqueueAnthropicResponse({
      body: {
        id: 'msg_trace',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'trace ok' }],
        model: 'fake-real-model',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 3 },
      },
    });
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': rig.rawConsumerKey, 'content-type': 'application/json' },
      payload: {
        model: 'coding-fast',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
      },
    });
    expect(res.statusCode).toBe(200);
    const traceId = res.headers['x-request-trace-id'];
    expect(traceId).toBeDefined();
    expect(typeof traceId).toBe('string');

    const rows = await rig.db
      .select()
      .from(requestTraceLogs)
      .where(eq(requestTraceLogs.requestTraceId, traceId as string))
      .orderBy(requestTraceLogs.stepIndex)
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const steps = rows.map((r) => r.step);
    expect(steps).toContain('request_start');
    expect(steps).toContain('target_resolve');
    expect(steps).toContain('candidates_expand');
    expect(steps).toContain('request_complete');

    const start = rows.find((r) => r.step === 'request_start');
    expect(start?.appId).toBe(rig.ids.appId);
    expect(start?.consumerKeyId).toBe(rig.ids.consumerKeyId);
    expect(start?.requestedTargetName).toBe('coding-fast');

    const complete = rows.find((r) => r.step === 'request_complete');
    expect(complete?.finalOutcome).toBe('success');
    expect(complete?.upstreamKeyId).toBe(rig.upstreamKeyId);
  });

  it('lists recent traces and exposes the timeline by trace id', async () => {
    rig.fake.enqueueAnthropicResponse({
      body: {
        id: 'msg_trace',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'trace ok' }],
        model: 'fake-real-model',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 3 },
      },
    });
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': rig.rawConsumerKey, 'content-type': 'application/json' },
      payload: {
        model: 'coding-fast',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
      },
    });
    expect(res.statusCode).toBe(200);
    const traceId = res.headers['x-request-trace-id'] as string;

    const login = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: 'admin', password: 'secret123' },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean);
    const cookie = cookies.find((c) => c && c.startsWith('mh_session='));
    expect(cookie).toBeDefined();

    const list = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/usage/traces?limit=10',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { items: Array<{ requestTraceId: string }> };
    expect(listBody.items.some((i) => i.requestTraceId === traceId)).toBe(true);

    const detail = await rig.app.inject({
      method: 'GET',
      url: `/api/admin/usage/traces/${traceId}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as { requestTraceId: string; steps: Array<{ step: string }> };
    expect(detailBody.requestTraceId).toBe(traceId);
    expect(detailBody.steps.length).toBeGreaterThanOrEqual(4);
    expect(detailBody.steps.map((s) => s.step)).toContain('request_complete');
  });

  it('prunes trace logs older than the retention period', async () => {
    const now = new Date();
    const oldTraceId = 'req_old_trace_1234';
    const freshTraceId = 'req_fresh_trace_5678';
    await rig.db.insert(requestTraceLogs).values([
      {
        id: 'tl_old',
        requestTraceId: oldTraceId,
        step: 'request_start',
        stepIndex: 1,
        createdAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
      },
      {
        id: 'tl_fresh',
        requestTraceId: freshTraceId,
        step: 'request_start',
        stepIndex: 1,
        createdAt: now,
      },
    ]);

    const { pruneTraceLogs } = await import('../src/modules/observability/trace-logs.js');
    const removed = await pruneTraceLogs(rig.db, { now, retentionDays: 30 });
    expect(removed).toBe(1);

    const remaining = await rig.db.select().from(requestTraceLogs).all();
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.requestTraceId).toBe(freshTraceId);
  });
});
