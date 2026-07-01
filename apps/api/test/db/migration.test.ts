import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { initSchema, currentSchemaVersion } from '../../src/infrastructure/db/init.js';
import { schemaMigrations } from '../../src/infrastructure/db/schema.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('database migrations', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('migrates empty database to the latest version', async () => {
    const version = await currentSchemaVersion(testDb.db);
    expect(version).toBe(22);
    const rows = await testDb.db.select().from(schemaMigrations);
    expect(rows).toHaveLength(22);
    expect(rows.map((r) => r.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
    ]);
  });

  it('initSchema is idempotent', async () => {
    await initSchema(testDb.db);
    await initSchema(testDb.db);
    const rows = await testDb.db.select().from(schemaMigrations);
    expect(rows).toHaveLength(22);
  });

  it('v9 creates endpoints table', async () => {
    // v9 仅验证 endpoints 表结构创建成功；行级 backfill 由 Step 2 的
    // endpoint 服务 / 仓库测试覆盖。
    const { endpoints } = await import('../../src/infrastructure/db/schema.js');
    const exists = await testDb.db.select().from(endpoints).limit(1);
    expect(exists).toBeDefined();
  });
});
