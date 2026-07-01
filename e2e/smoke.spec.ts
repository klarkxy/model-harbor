import { test, expect, request as playwrightRequest } from '@playwright/test';

const API_PORT = Number(
  process.env['MYLLM_E2E_API_PORT'] ?? process.env['MANAGE_YOUR_LLM_E2E_API_PORT'] ?? 3001,
);
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'change-me-on-first-run';

interface ApiEnvelope<T> {
  data: T;
}

async function postJson<T>(
  ctx: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await ctx.post(path, { data: body });
  if (res.status() >= 400) {
    throw new Error(`${path} ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

test('smoke: web app loads after setup', async ({ page, baseURL }) => {
  // v1 Phase 8：空库首次访问重定向 Setup Wizard。要验证 sidebar 可见，
  // 先用 API 走完 setup，再访问 /。
  const apiCtx = await playwrightRequest.newContext({
    baseURL: `${baseURL!.replace(/:\d+$/, `:${API_PORT}`)}`,
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  });
  try {
    const statusRes = await apiCtx.get('/api/admin/setup/status');
    const status = (await statusRes.json()) as { data: { needsSetup: boolean } };
    if (status.data.needsSetup) {
      // Step 1: 创建 admin。
      const admin = await postJson<ApiEnvelope<{ ok: boolean }>>(
        apiCtx,
        '/api/admin/setup/security',
        { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, displayName: 'Admin' },
      );
      expect(admin.data.ok).toBe(true);

      // Step 2: 创建 provider account。
      const upstream = await postJson<ApiEnvelope<{ providerAccountId: string }>>(
        apiCtx,
        '/api/admin/setup/upstream',
        {
          name: 'smoke-upstream',
          providerType: 'openai_compatible',
          baseUrl: 'https://example.com',
          apiKey: 'sk-smoke',
        },
      );

      // Step 3: 创建 model。setup.models 接受 names 数组（v1 wizard 简化形式）。
      await postJson<ApiEnvelope<{ modelIds: string[] }>>(apiCtx, '/api/admin/setup/models', {
        models: [
          {
            name: 'smoke-model',
            candidates: [
              {
                providerAccountId: upstream.data.providerAccountId,
                realModelName: 'smoke-real',
              },
            ],
          },
        ],
      });

      // Step 4: 创建 client 和 key。
      await postJson<ApiEnvelope<{ rawKey: string }>>(apiCtx, '/api/admin/setup/client-key', {});
    }

    await page.goto('/');
    await expect(page.locator('text=ManageYourLLM')).toBeVisible();
  } finally {
    await apiCtx.dispose();
  }
});
