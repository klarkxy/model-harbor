import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { AppRepository } from '../../src/infrastructure/db/repositories/app.repository.js';
import { ConsumerKeyRepository } from '../../src/infrastructure/db/repositories/consumer-key.repository.js';
import { PublicModelRepository } from '../../src/infrastructure/db/repositories/public-model.repository.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import { AccessPolicyService } from '../../src/domain/identity-access/access-policy.service.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('access policy service', () => {
  let testDb: TestDb;
  let service: AccessPolicyService;
  let consumerRepo: ConsumerKeyRepository;
  let publicModelRepo: PublicModelRepository;
  let targetRepo: TargetRepository;
  let appId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new AccessPolicyService(testDb.db);
    consumerRepo = new ConsumerKeyRepository(testDb.db);
    publicModelRepo = new PublicModelRepository(testDb.db);
    targetRepo = new TargetRepository(testDb.db);
    const app = await new AppRepository(testDb.db).createApp({ name: 'Test App', enabled: true });
    appId = app.id;
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('allows all access mode for any target', async () => {
    const model = await publicModelRepo.createPublicModel({ name: 'gpt-5', enabled: true });
    await targetRepo.createTargetName({
      name: 'gpt-5',
      targetType: 'public_model',
      targetId: model.id,
    });
    const key = await consumerRepo.createConsumerKey({
      appId,
      name: 'all key',
      keyHash: 'h1',
      keyPrefix: 'ck_',
      accessMode: 'all',
      enabled: true,
    });
    const result = await service.checkAccess(key, 'gpt-5');
    expect(result.allowed).toBe(true);
    expect(result.targetType).toBe('public_model');
  });

  it('denies restricted key for non-granted target', async () => {
    const model = await publicModelRepo.createPublicModel({ name: 'claude-x', enabled: true });
    await targetRepo.createTargetName({
      name: 'claude-x',
      targetType: 'public_model',
      targetId: model.id,
    });
    const key = await consumerRepo.createConsumerKey({
      appId,
      name: 'restricted key',
      keyHash: 'h2',
      keyPrefix: 'ck_',
      accessMode: 'restricted',
      enabled: true,
    });
    await consumerRepo.addAccess(key.id, 'public_model', 'pm_other');
    const result = await service.checkAccess(key, 'claude-x');
    expect(result.allowed).toBe(false);
  });

  it('allows restricted key for granted target', async () => {
    const model = await publicModelRepo.createPublicModel({ name: 'coder-group', enabled: true });
    // 注意：public model 创建服务会自动写 target namespace，测试里直接创建 model 后手动补 target。
    await targetRepo.createTargetName({
      name: 'coder-group',
      targetType: 'public_model',
      targetId: model.id,
    });
    const key = await consumerRepo.createConsumerKey({
      appId,
      name: 'restricted key',
      keyHash: 'h3',
      keyPrefix: 'ck_',
      accessMode: 'restricted',
      enabled: true,
    });
    await consumerRepo.addAccess(key.id, 'public_model', model.id);
    const result = await service.checkAccess(key, 'coder-group');
    expect(result.allowed).toBe(true);
  });
});
