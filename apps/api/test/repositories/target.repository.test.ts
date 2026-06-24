import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('target repository', () => {
  let testDb: TestDb;
  let repo: TargetRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new TargetRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('creates and finds target namespace rows', async () => {
    await repo.createTargetName({
      name: 'gpt-5',
      targetType: 'public_model',
      targetId: 'pm_1',
    });
    const found = await repo.findByName('gpt-5');
    expect(found).toBeDefined();
    expect(found!.targetType).toBe('public_model');
  });

  it('deletes target by target id and type', async () => {
    await repo.createTargetName({ name: 'coder', targetType: 'model_group', targetId: 'mg_1' });
    await repo.deleteByTarget('model_group', 'mg_1');
    expect(await repo.findByName('coder')).toBeUndefined();
  });
});
