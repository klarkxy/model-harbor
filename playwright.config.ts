// Playwright E2E 配置。
// Phase 0 仅提供骨架，e2e 测试在 dev 服务器可访问后运行。

import { defineConfig } from '@playwright/test';

const API_PORT = Number(
  process.env['MYLLM_E2E_API_PORT'] ?? process.env['MANAGE_YOUR_LLM_E2E_API_PORT'] ?? 3001,
);
const WEB_PORT = Number(
  process.env['MYLLM_E2E_WEB_PORT'] ?? process.env['MANAGE_YOUR_LLM_E2E_WEB_PORT'] ?? 5180,
);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    headless: true,
  },
  webServer: [
    {
      command: `pnpm --filter @manageyourllm/shared build && pnpm --filter @manageyourllm/api exec tsx src/main.ts`,
      port: API_PORT,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      env: {
        MYLLM_PORT: String(API_PORT),
        MYLLM_DATABASE_URL: 'file:../../data/e2e-manageyourllm.sqlite',
        MYLLM_SECRET_KEY: 'e2e-secret-key-not-the-default',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm --filter @manageyourllm/shared build && pnpm --filter @manageyourllm/web exec vite --port ${WEB_PORT} --host 127.0.0.1 --strictPort`,
      port: WEB_PORT,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      env: {
        MYLLM_API_PORT: String(API_PORT),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
