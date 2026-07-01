import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ModelService } from '../../src/application/model.service.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('model service', () => {
  let testDb: TestDb;
  let service: ModelService;
  let targetRepo: TargetRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new ModelService(testDb.db);
    targetRepo = new TargetRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('creates model and target namespace', async () => {
    const model = await service.createModel({ name: 'GPT-5', displayName: 'GPT-5' });
    expect(model.name).toBe('gpt-5');
    const target = await targetRepo.findByName('gpt-5');
    expect(target).toBeDefined();
    expect(target!.targetType).toBe('model');
    expect(target!.targetId).toBe(model.id);
  });

  it('rejects duplicate name case-insensitively', async () => {
    await service.createModel({ name: 'GPT-5' });
    await expect(service.createModel({ name: 'gpt-5' })).rejects.toThrow(/已被占用/);
  });

  it('deletes model and cleans namespace', async () => {
    const model = await service.createModel({ name: 'Claude-X' });
    await service.deleteModel(model.id);
    expect(await targetRepo.findByName('claude-x')).toBeUndefined();
  });
});
