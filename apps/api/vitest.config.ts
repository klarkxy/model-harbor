import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      // 排除:入口、错误定义、路由装配层
      // 说明:main.ts / server.ts 是 fastify 启动装配,errors.ts 是错误类定义,
      // plugins/health.ts 是 200 字以内的探活路由 —— 这三个文件的逻辑
      // 已经被 server.test.ts / gateway.test.ts / health.test.ts 间接覆盖,
      // 单测价值极低;真正决定覆盖率的是 modules/ 子树。
      exclude: [
        'src/main.ts',
        'src/server.ts',
        'src/errors.ts',
        'src/plugins/**',
      ],
      // 第一次先开宽松点,后面再逐步收
      // 基线:tests=200+ 但 src 大量未被 import 的纯 helper/未覆盖分支,先放行。
      thresholds: {
        lines: 60,
        functions: 55,
        branches: 55,
        statements: 60,
      },
    },
  },
});
