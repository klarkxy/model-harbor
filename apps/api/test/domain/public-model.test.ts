import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { PublicModelService } from '../../src/domain/model-catalog/public-model.service.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('public model service', () => {
  let testDb: TestDb;
  let service: PublicModelService;
  let targetRepo: TargetRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new PublicModelService(testDb.db);
    targetRepo = new TargetRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('creates public model and target namespace', async () => {
    const model = await service.createPublicModel({ name: 'GPT-5', displayName: 'GPT-5' });
    expect(model.name).toBe('gpt-5');
    const target = await targetRepo.findByName('gpt-5');
    expect(target).toBeDefined();
    expect(target!.targetType).toBe('public_model');
    expect(target!.targetId).toBe(model.id);
  });

  it('rejects duplicate name case-insensitively', async () => {
    await service.createPublicModel({ name: 'GPT-5' });
    await expect(service.createPublicModel({ name: 'gpt-5' })).rejects.toThrow(/已被占用/);
  });

  it('deletes public model and cleans namespace', async () => {
    const model = await service.createPublicModel({ name: 'Claude-X' });
    await service.deletePublicModel(model.id);
    expect(await targetRepo.findByName('claude-x')).toBeUndefined();
  });
});
