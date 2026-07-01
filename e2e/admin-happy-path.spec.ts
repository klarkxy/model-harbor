import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'change-me-on-first-run';

interface ApiEnvelope<T> {
  data: T;
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
          id: 'chatcmpl-happy',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: realModelName,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello from happy path' },
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

async function setEnglishLocale(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('manageyourllm-locale', 'en');
  });
}

test.describe('admin happy path', () => {
  let mockServer: Server;
  let mockPort: number;
  let adminCtx: APIRequestContext;

  test.beforeAll(async () => {
    ({ server: mockServer, port: mockPort } = await startMockUpstream());

    const API_PORT = Number(
      process.env['MYLLM_E2E_API_PORT'] ?? process.env['MANAGE_YOUR_LLM_E2E_API_PORT'] ?? 3001,
    );

    adminCtx = await playwrightRequest.newContext({
      baseURL: `http://127.0.0.1:${API_PORT}`,
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

    const suffix = Date.now().toString(36);
    // v1 Phase 6：createClient 返回 { client, rawKey }（当前 e2e 不直接使用 key）。
    const _app = await postJson<ApiEnvelope<{ client: { id: string }; rawKey: string }>>(
      adminCtx,
      '/api/admin/clients',
      { name: `Happy Path Client ${suffix}` },
    );

    const upstream = await postJson<ApiEnvelope<{ id: string }>>(
      adminCtx,
      '/api/admin/provider-accounts',
      {
        name: `happy-upstream-${suffix}`,
        providerType: 'openai_compatible',
        baseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'sk-happy',
      },
    );

    // v1 Phase 2 收口：candidate 强制 endpointId。先 list endpoints 拿 id。
    const endpoints = await getJson<ApiEnvelope<Array<{ id: string }>>>(
      adminCtx,
      `/api/admin/endpoints?providerAccountId=${upstream.data.id}`,
    );
    const endpointId = endpoints.data[0]?.id;
    if (!endpointId) {
      throw new Error('happy-path: no endpoint created for upstream');
    }

    await postJson(adminCtx, '/api/admin/models', {
      name: `happy-model-${suffix}`,
      displayName: 'Happy Model',
      candidates: [
        { providerAccountId: upstream.data.id, endpointId, realModelName: 'happy-real' },
      ],
    });

    // v1 Phase 6：createClient 已自动生成 active key，无需再手动调 /clients/keys。
  });

  test.afterAll(async () => {
    await adminCtx?.dispose();
    await stopMockUpstream(mockServer);
  });

  test('login and create a backup', async ({ page }) => {
    await setEnglishLocale(page);
    const backupNote = `happy-backup-${Date.now().toString(36)}`;

    // Login
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByRole('textbox').nth(0).fill(ADMIN_USERNAME);
    await page.getByRole('textbox').nth(1).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/', { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Overview' }).first()).toBeVisible();

    // v1 Phase 6+8 收口：setup 已通过 API 完成（beforeAll），无需再走 wizard UI。
    // 直接到 backups 页面验证 Backups 视图 + 创建备份。
    await page.goto('/backups', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Backups' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Create Backup' }).click();
    await page.getByRole('textbox').fill(backupNote);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: backupNote })).toBeVisible();
  });
});
