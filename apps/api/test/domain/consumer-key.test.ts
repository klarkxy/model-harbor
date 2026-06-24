import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { AppRepository } from '../../src/infrastructure/db/repositories/app.repository.js';
import { ConsumerKeyRepository } from '../../src/infrastructure/db/repositories/consumer-key.repository.js';
import { ConsumerKeyService } from '../../src/domain/identity-access/consumer-key.service.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('consumer key service', () => {
  let testDb: TestDb;
  let appRepo: AppRepository;
  let service: ConsumerKeyService;
  let appId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    appRepo = new AppRepository(testDb.db);
    service = new ConsumerKeyService(testDb.db);
    const app = await appRepo.createApp({ name: 'Test App', enabled: true });
    appId = app.id;
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('creates consumer key and returns raw key only once', async () => {
    const result = await service.createConsumerKey({ appId, name: 'default key' });
    expect(result.rawKey).toMatch(/^ck_/);
    expect(result.consumerKey.keyHash).not.toBe(result.rawKey);
    expect(result.consumerKey.keyPrefix).toMatch(/^ck_/);

    const verified = await service.verifyRawKey(result.rawKey);
    expect(verified).toBeDefined();
    expect(verified!.id).toBe(result.consumerKey.id);
  });

  it('rotates consumer key and returns new raw key', async () => {
    const first = await service.createConsumerKey({ appId, name: 'rotating key' });
    const rotated = await service.rotateConsumerKey(first.consumerKey.id);
    expect(rotated.rawKey).not.toBe(first.rawKey);
    expect(rotated.consumerKey.keyHash).not.toBe(first.consumerKey.keyHash);

    const oldVerified = await service.verifyRawKey(first.rawKey);
    expect(oldVerified).toBeUndefined();
  });

  it('supports restricted access mode and persists access rows', async () => {
    const result = await service.createConsumerKey({
      appId,
      name: 'restricted key',
      accessMode: 'restricted',
      accessTargets: [{ targetType: 'public_model', targetId: 'pm_1' }],
    });
    expect(result.consumerKey.accessMode).toBe('restricted');

    const withAccess = await new ConsumerKeyRepository(testDb.db).findByIdWithAccess(
      result.consumerKey.id,
    );
    expect(withAccess).toBeDefined();
    expect(withAccess!.access).toHaveLength(1);
    expect(withAccess!.access[0]!.targetType).toBe('public_model');
    expect(withAccess!.access[0]!.targetId).toBe('pm_1');
  });
});
