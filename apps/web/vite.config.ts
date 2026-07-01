import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// Vite 在 Windows 上通过 node:net 解析 `localhost` 时默认使用 ::1（IPv6），
// 可能在上游只绑定 IPv4 时失败。这里固定使用 127.0.0.1，并从环境变量读取端口。
const API_PORT = Number(
  process.env['MYLLM_API_PORT'] ?? process.env['MANAGE_YOUR_LLM_API_PORT'] ?? 5420,
);
const API_TARGET = `http://127.0.0.1:${API_PORT}`;
const WEB_PORT = Number(
  process.env['MYLLM_WEB_PORT'] ?? process.env['MANAGE_YOUR_LLM_WEB_PORT'] ?? 5421,
);

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: WEB_PORT,
    host: '127.0.0.1',
    proxy: {
      '/api': API_TARGET,
      '/v1': API_TARGET,
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/main.ts',
        'src/App.vue',
        'src/router/**',
        'src/locales/**',
        'src/api/**',
        'src/test-utils.ts',
      ],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
  },
});
