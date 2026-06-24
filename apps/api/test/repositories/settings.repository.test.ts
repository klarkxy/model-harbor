import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { SettingsRepository } from '../../src/infrastructure/db/repositories/settings.repository.js';
import { adminSettings } from '../../src/infrastructure/db/schema.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('settings repository', () => {
  let testDb: TestDb;
  let repo: SettingsRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new SettingsRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('seeds default settings idempotently', async () => {
    const first = await repo.seedDefaultSettings();
    expect(first.id).toBe('default');
    expect(first.circuitBreakerFailureThreshold).toBe(5);

    const second = await repo.seedDefaultSettings();
    expect(second.id).toBe(first.id);

    const rows = await testDb.db.select().from(adminSettings);
    expect(rows).toHaveLength(1);
  });

  it('updates settings', async () => {
    await repo.seedDefaultSettings();
    const updated = await repo.updateSettings({ firstTokenTimeoutMs: 30_000 });
    expect(updated!.firstTokenTimeoutMs).toBe(30_000);
  });
});
