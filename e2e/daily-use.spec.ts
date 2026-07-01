import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const API_PORT = Number(
  process.env['MYLLM_E2E_API_PORT'] ?? process.env['MANAGE_YOUR_LLM_E2E_API_PORT'] ?? 3001,
);
const WEB_PORT = Number(
  process.env['MYLLM_E2E_WEB_PORT'] ?? process.env['MANAGE_YOUR_LLM_E2E_WEB_PORT'] ?? 5180,
);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'change-me-on-first-run';

interface ApiEnvelope<T> {
  data: T;
}

async function loginAdmin(ctx: APIRequestContext): Promise<void> {
  const res = await ctx.post('/api/admin/auth/login', {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  expect(res.status()).toBe(200);
}

async function postJson<T>(ctx: APIRequestContext, path: string, body: unknown): Promise<T> {
  const res = await ctx.post(path, { data: body });
  expect(res.status()).toBe(200);
  return (await res.json()) as T;
}

async function getJson<T>(ctx: APIRequestContext, path: string): Promise<T> {
  const res = await ctx.get(path);
  expect(res.status()).toBe(200);
  return (await res.json()) as T;
}

function startMockUpstream(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const upstreamBody = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        const realModelName = (upstreamBody.model as string) ?? 'unknown';
        const response = {
          id: 'chatcmpl-daily',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: realModelName,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello from e2e' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

function stopMockUpstream(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function todayIso(): string {
  return new Date().toISOString();
}

function todayDate(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

test.describe('daily use', () => {
  let mockServer: Server;
  let mockPort: number;
  let adminCtx: APIRequestContext;
  let sessionCookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
  }> = [];
  let modelName: string;
  let planName: string;

  test.beforeAll(async () => {
    ({ server: mockServer, port: mockPort } = await startMockUpstream());

    adminCtx = await playwrightRequest.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });

    // v1 Phase 8：空库先 setup（建 admin），再 login。
    const status = await adminCtx.get('/api/admin/setup/status');
    const statusJson = (await status.json()) as { data: { needsSetup: boolean } };
    if (statusJson.data.needsSetup) {
      await postJson<ApiEnvelope<{ ok: boolean }>>(adminCtx, '/api/admin/setup/security', {
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
        displayName: 'Admin',
      });
    }

    await loginAdmin(adminCtx);
    const state = await adminCtx.storageState();
    sessionCookies = state.cookies.map((c) => ({
      ...c,
      domain: '127.0.0.1',
    }));

    const suffix = Date.now().toString(36);
    modelName = `daily-model-${suffix}`;
    const appName = `Daily Use Client ${suffix}`;
    const upstreamName = `daily-openai-${suffix}`;
    planName = `Monthly Token Pack ${suffix}`;

    const app = await postJson<ApiEnvelope<{ id: string }>>(adminCtx, '/api/admin/clients', {
      name: appName,
    });

    const upstream = await postJson<ApiEnvelope<{ id: string }>>(
      adminCtx,
      '/api/admin/provider-accounts',
      {
        name: upstreamName,
        providerType: 'openai_compatible',
        baseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'sk-daily',
      },
    );

    // v1 Phase 2 收口：candidate 强制 endpointId。先 list endpoints 拿 id。
    const endpoints = await getJson<ApiEnvelope<Array<{ id: string }>>>(
      adminCtx,
      `/api/admin/endpoints?providerAccountId=${upstream.data.id}`,
    );
    const endpointId = endpoints.data[0]?.id;
    if (!endpointId) {
      throw new Error('daily-use: no endpoint created for upstream');
    }

    await postJson(adminCtx, '/api/admin/models', {
      name: modelName,
      displayName: 'Daily Model',
      candidates: [
        { providerAccountId: upstream.data.id, endpointId, realModelName: 'gpt-4o-real' },
      ],
    });

    // v1 Phase 6：createClient 已自动生成 active key，无需再调 /clients/keys。
    const consumerRawKey = app.data.rawKey;

    await postJson(adminCtx, '/api/admin/costs/pricing', {
      providerType: 'openai_compatible',
      providerAccountId: upstream.data.id,
      realModelName: 'gpt-4o-real',
      inputPricePer1k: 5000,
      outputPricePer1k: 15000,
      currency: 'USD',
      effectiveFrom: todayIso(),
    });

    await postJson(adminCtx, '/api/admin/costs/plans', {
      planType: 'token',
      name: planName,
      providerType: 'openai_compatible',
      providerAccountId: upstream.data.id,
      totalAmount: 1_000_000,
      unit: 'token',
      period: 'monthly',
      purchasedAt: todayIso(),
      validFrom: todayIso(),
      validUntil: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      reminderDays: 7,
    });

    const chatRes = await adminCtx.post('/v1/chat/completions', {
      headers: { Authorization: `Bearer ${consumerRawKey}` },
      data: { model: modelName, messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(chatRes.status()).toBe(200);
    const chat = (await chatRes.json()) as { choices: unknown[] };
    expect(chat.choices).toHaveLength(1);

    // Wait until usage records are visible in the dashboard before running web assertions.
    await expect
      .poll(async () => {
        const since = new Date(Date.now() - 60_000).toISOString();
        const dashboard = await getJson<
          ApiEnvelope<{
            summary: { requestCount: number };
            groups: { byTarget: { name: string }[] };
          }>
        >(adminCtx, `/api/admin/usage/dashboard?since=${encodeURIComponent(since)}`);
        return dashboard.data.summary.requestCount;
      })
      .toBeGreaterThanOrEqual(1);
  });

  test.afterAll(async () => {
    await adminCtx?.dispose();
    await stopMockUpstream(mockServer);
  });

  test('admin web shows usage, traces and plan reminders', async ({ page }) => {
    await page.context().addCookies(sessionCookies);

    await page.goto(`${WEB_URL}/usage`, { waitUntil: 'networkidle' });
    await expect(page.locator(`text=${modelName}`).first()).toBeVisible();
    await expect(page.locator('text=gpt-4o-real').first()).toBeVisible();

    await page.goto(`${WEB_URL}/traces`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('cell', { name: modelName }).first()).toBeVisible();
    const traceRow = page.getByRole('row').filter({ hasText: modelName }).first();
    await traceRow.locator('td:has-text("ms")').first().click();
    await expect(page.locator('text=gpt-4o-real').first()).toBeVisible();

    await page.goto(`${WEB_URL}/costs`, { waitUntil: 'networkidle' });
    // v1 Phase 7 收口：Costs 拆为 Pricing + Plans 两个 tab；切到 Plans 标签查 plan。
    await page.locator('text=Token / Coding Plans').first().click();
    await expect(page.getByRole('cell', { name: planName }).first()).toBeVisible();
  });

  test('admin api exposes usage dashboard, daily stats, traces and plan reminders', async () => {
    const since = new Date(Date.now() - 60_000).toISOString();

    const dashboard = await getJson<
      ApiEnvelope<{
        summary: { requestCount: number; costAmount: number | null; unpricedCount: number };
        groups: { byTarget: { name: string }[] };
      }>
    >(adminCtx, `/api/admin/usage/dashboard?since=${encodeURIComponent(since)}`);
    expect(dashboard.data.summary.requestCount).toBeGreaterThanOrEqual(1);
    expect(dashboard.data.groups.byTarget.some((t) => t.name === modelName)).toBe(true);

    const daily = await getJson<
      ApiEnvelope<Array<{ realModelName: string; requestCount: number }>>
    >(adminCtx, `/api/admin/usage/daily?date=${todayDate()}`);
    expect(daily.data.some((r) => r.realModelName === 'gpt-4o-real' && r.requestCount >= 1)).toBe(
      true,
    );

    const traces = await getJson<
      ApiEnvelope<
        Array<{
          requestedTargetName: string;
          resolvedTargetType: string | null;
          resolvedTargetId: string | null;
        }>
      >
    >(adminCtx, `/api/admin/traces?since=${encodeURIComponent(since)}&limit=100`);
    const trace = traces.data.find((t) => t.requestedTargetName === modelName);
    expect(trace).toBeDefined();
    expect(trace?.resolvedTargetType).toBe('model');
    expect(trace?.resolvedTargetId).toBeTruthy();

    const reminders = await getJson<
      ApiEnvelope<Array<{ reasons: string[]; plan: { name: string } }>>
    >(adminCtx, '/api/admin/costs/plans/reminders');
    expect(
      reminders.data.some(
        (r) => r.plan.name.startsWith('Monthly Token Pack') && r.reasons.includes('expiring'),
      ),
    ).toBe(true);
  });
});
