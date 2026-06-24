import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { AppRepository } from '../../src/infrastructure/db/repositories/app.repository.js';
import { ConsumerKeyRepository } from '../../src/infrastructure/db/repositories/consumer-key.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('consumer key repository', () => {
  let testDb: TestDb;
  let appRepo: AppRepository;
  let repo: ConsumerKeyRepository;
  let appId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    appRepo = new AppRepository(testDb.db);
    repo = new ConsumerKeyRepository(testDb.db);
    const app = await appRepo.createApp({ name: 'Test App', enabled: true });
    appId = app.id;
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('replaces access list in transaction', async () => {
    const key = await repo.createConsumerKey({
      appId,
      name: 'key',
      keyHash: 'hash1',
      keyPrefix: 'ck_',
      accessMode: 'restricted',
      enabled: true,
    });
    await repo.replaceAccess(key.id, [
      { targetType: 'public_model', targetId: 'pm_1' },
      { targetType: 'model_group', targetId: 'mg_1' },
    ]);
    const withAccess = await repo.findByIdWithAccess(key.id);
    expect(withAccess!.access).toHaveLength(2);
    expect(withAccess!.access.map((a) => a.targetType).sort()).toEqual([
      'model_group',
      'public_model',
    ]);
  });

  it('deletes access by consumer key', async () => {
    const key = await repo.createConsumerKey({
      appId,
      name: 'key2',
      keyHash: 'hash2',
      keyPrefix: 'ck_',
      accessMode: 'restricted',
      enabled: true,
    });
    await repo.addAccess(key.id, 'public_model', 'pm_1');
    await repo.deleteAccessByConsumerKey(key.id);
    const access = await repo.listAccessByKey(key.id);
    expect(access).toHaveLength(0);
  });
});
