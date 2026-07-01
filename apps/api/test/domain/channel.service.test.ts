import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ModelRepository } from '../../src/infrastructure/db/repositories/model.repository.js';
import { ChannelService } from '../../src/application/channel.service.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('channel service', () => {
  let testDb: TestDb;
  let service: ChannelService;
  let modelRepo: ModelRepository;
  let targetRepo: TargetRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new ChannelService(testDb.db);
    modelRepo = new ModelRepository(testDb.db);
    targetRepo = new TargetRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('creates channel with members and target namespace', async () => {
    const model = await modelRepo.createModel({ name: 'gpt-4o', enabled: true });
    const channel = await service.createChannel({
      name: 'Coder',
      members: [{ modelId: model.id }],
    });
    expect(channel.name).toBe('coder');
    const target = await targetRepo.findByName('coder');
    expect(target).toBeDefined();
    const withMembers = await service['channelRepo']().findWithMembers(channel.id);
    expect(withMembers!.members).toHaveLength(1);
  });

  it('rejects member that is not a model', async () => {
    await expect(
      service.createChannel({
        name: 'BadChannel',
        members: [{ modelId: 'not-a-real-id' }],
      }),
    ).rejects.toThrow(/未找到/);
  });

  it('cleans namespace on delete', async () => {
    const channel = await service.createChannel({ name: 'Fast' });
    await service.deleteChannel(channel.id);
    expect(await targetRepo.findByName('fast')).toBeUndefined();
  });
});
