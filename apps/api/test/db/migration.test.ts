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

  it('migrates empty database to version 1', async () => {
    const version = await currentSchemaVersion(testDb.db);
    expect(version).toBe(5);
    const rows = await testDb.db.select().from(schemaMigrations);
    expect(rows).toHaveLength(5);
    expect(rows[0]!.version).toBe(1);
    expect(rows[1]!.version).toBe(2);
    expect(rows[2]!.version).toBe(3);
    expect(rows[3]!.version).toBe(4);
    expect(rows[4]!.version).toBe(5);
  });

  it('initSchema is idempotent', async () => {
    await initSchema(testDb.db);
    await initSchema(testDb.db);
    const rows = await testDb.db.select().from(schemaMigrations);
    expect(rows).toHaveLength(5);
  });
});
