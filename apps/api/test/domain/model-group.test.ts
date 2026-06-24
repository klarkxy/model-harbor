import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { PublicModelRepository } from '../../src/infrastructure/db/repositories/public-model.repository.js';
import { ModelGroupService } from '../../src/domain/model-catalog/model-group.service.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('model group service', () => {
  let testDb: TestDb;
  let service: ModelGroupService;
  let publicModelRepo: PublicModelRepository;
  let targetRepo: TargetRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new ModelGroupService(testDb.db);
    publicModelRepo = new PublicModelRepository(testDb.db);
    targetRepo = new TargetRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('creates group with members and target namespace', async () => {
    const pm = await publicModelRepo.createPublicModel({ name: 'gpt-4o', enabled: true });
    const group = await service.createModelGroup({
      name: 'Coder',
      members: [{ publicModelId: pm.id }],
    });
    expect(group.name).toBe('coder');
    const target = await targetRepo.findByName('coder');
    expect(target).toBeDefined();
    const withMembers = await service['modelGroupRepo']().findWithMembers(group.id);
    expect(withMembers!.members).toHaveLength(1);
  });

  it('rejects member that is not a public model', async () => {
    await expect(
      service.createModelGroup({
        name: 'BadGroup',
        members: [{ publicModelId: 'not-a-real-id' }],
      }),
    ).rejects.toThrow(/未找到/);
  });

  it('cleans namespace on delete', async () => {
    const group = await service.createModelGroup({ name: 'Fast' });
    await service.deleteModelGroup(group.id);
    expect(await targetRepo.findByName('fast')).toBeUndefined();
  });
});
