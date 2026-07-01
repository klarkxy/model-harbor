import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    hookTimeout: 30_000,
    // Windows + SQLite 文件锁：并行测试文件在清理临时数据库时容易 EBUSY，
    // 串行执行 API 测试文件换取稳定性。单文件内部仍可并行用例。
    fileParallelism: false,
  },
});
