import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ChannelRepository } from '../../src/infrastructure/db/repositories/channel.repository.js';
import { ModelRepository } from '../../src/infrastructure/db/repositories/model.repository.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('channel repository', () => {
  let testDb: TestDb;
  let repo: ChannelRepository;
  let modelRepo: ModelRepository;
  let targetRepo: TargetRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new ChannelRepository(testDb.db);
    modelRepo = new ModelRepository(testDb.db);
    targetRepo = new TargetRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('creates channel with members and replaces members', async () => {
    const m1 = await modelRepo.createModel({ name: 'gpt-4o', enabled: true });
    const m2 = await modelRepo.createModel({ name: 'claude-sonnet', enabled: true });
    const channel = await repo.createChannel({ name: 'coder', enabled: true });
    await repo.replaceMembers(channel.id, [
      { modelId: m1.id, priority: 100 },
      { modelId: m2.id, priority: 200 },
    ]);
    const withMembers = await repo.findWithMembers(channel.id);
    expect(withMembers!.members).toHaveLength(2);
  });

  it('deletes channel and cleans target namespace', async () => {
    const channel = await repo.createChannel({ name: 'fast', enabled: true });
    await targetRepo.createTargetName({
      name: 'fast',
      targetType: 'channel',
      targetId: channel.id,
    });
    await repo.deleteChannel(channel.id);
    expect(await repo.findById(channel.id)).toBeUndefined();
    expect(await targetRepo.findByName('fast')).toBeUndefined();
  });
});
