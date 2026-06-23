import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// Vite's proxy goes through node:net's `localhost` resolution, which on
// Windows resolves to ::1 (IPv6) by default and fails with EACCES when the
// upstream binds IPv4 only. Pin to 127.0.0.1 and read the api port from
// env so e2e runs and local dev both work.
const API_PORT = Number(process.env['MODELHARBOR_API_PORT'] ?? 5420);
const API_TARGET = `http://127.0.0.1:${API_PORT}`;
const WEB_PORT = Number(process.env['MODELHARBOR_WEB_PORT'] ?? 5421);

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: WEB_PORT,
    // Vite's default `host: "localhost"` resolves to ::1 on Windows, which
    // makes http://localhost:5421/ hang or fail with ERR_CONNECTION_REFUSED
    // for clients that resolve localhost to 127.0.0.1. Pin to 127.0.0.1 to
    // match the proxy target above.
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
      // v8 是 Vitest 官方推荐引擎,启动比 istanbul 快得多
      provider: 'v8',
      // 终端表格 + 可在浏览器里看行级覆盖的 HTML + 给 CI 用的 JSON 汇总
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,vue}'],
      // 排除:测试文件 / 类型声明 / 入口 / 路由 / 根 App / 纯展示小组件 / i18n 字典 / 纯 API 包装
      // 说明:api/admin.ts 几乎是按 endpoint 1:1 的纯转发函数,逐个 endpoint 写单测价值低且用例爆炸;
      // 真实 API 行为由 e2e 覆盖,这里只把 admin.ts/auth.ts 排除以聚焦页面/composable 层的逻辑覆盖率。
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/main.ts',
        'src/App.vue',
        'src/router/**',
        'src/locales/**',
        'src/api/**',
        'src/test-utils.ts',
        // 纯展示型小组件,没有值得单测的逻辑
        'src/components/DragHandle.vue',
        'src/components/EmptyState.vue',
        'src/components/CardContainer.vue',
        'src/components/menuIcons.ts',
      ],
      // 覆盖阈值 —— 第一次先开宽松点,后面再逐步收
      // 基线来自 2026-06-23 实测:tests=29,lines=74.19,branches=76.36,funcs=55.48,stmts=74.19
      // 函数覆盖偏低是因为 pages/*.vue 里有大量未触达的弹窗/抽屉辅助函数,后续按清单补单测
      thresholds: {
        lines: 70,
        functions: 50,
        branches: 70,
        statements: 70,
      },
    },
  },
});
