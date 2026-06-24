import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ModelGroupRepository } from '../../src/infrastructure/db/repositories/model-group.repository.js';
import { PublicModelRepository } from '../../src/infrastructure/db/repositories/public-model.repository.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('model group repository', () => {
  let testDb: TestDb;
  let repo: ModelGroupRepository;
  let publicModelRepo: PublicModelRepository;
  let targetRepo: TargetRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new ModelGroupRepository(testDb.db);
    publicModelRepo = new PublicModelRepository(testDb.db);
    targetRepo = new TargetRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('creates group with members and replaces members', async () => {
    const pm1 = await publicModelRepo.createPublicModel({ name: 'gpt-4o', enabled: true });
    const pm2 = await publicModelRepo.createPublicModel({ name: 'claude-sonnet', enabled: true });
    const group = await repo.createModelGroup({ name: 'coder', enabled: true });
    await repo.replaceMembers(group.id, [
      { publicModelId: pm1.id, priority: 100 },
      { publicModelId: pm2.id, priority: 200 },
    ]);
    const withMembers = await repo.findWithMembers(group.id);
    expect(withMembers!.members).toHaveLength(2);
  });

  it('deletes group and cleans target namespace', async () => {
    const group = await repo.createModelGroup({ name: 'fast', enabled: true });
    await targetRepo.createTargetName({
      name: 'fast',
      targetType: 'model_group',
      targetId: group.id,
    });
    await repo.deleteModelGroup(group.id);
    expect(await repo.findById(group.id)).toBeUndefined();
    expect(await targetRepo.findByName('fast')).toBeUndefined();
  });
});
