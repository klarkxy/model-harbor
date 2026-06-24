import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { PublicModelRepository } from '../../src/infrastructure/db/repositories/public-model.repository.js';
import { UpstreamKeyRepository } from '../../src/infrastructure/db/repositories/upstream-key.repository.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('public model repository', () => {
  let testDb: TestDb;
  let repo: PublicModelRepository;
  let upstreamRepo: UpstreamKeyRepository;
  let targetRepo: TargetRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new PublicModelRepository(testDb.db);
    upstreamRepo = new UpstreamKeyRepository(testDb.db);
    targetRepo = new TargetRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('creates public model with candidates', async () => {
    const upstream = await upstreamRepo.createUpstreamKey({
      name: 'Provider',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com',
      authType: 'pat',
      apiKeyCiphertext: 'enc',
      apiKeyPrefix: 'sk-',
    });
    const model = await repo.createPublicModel({
      name: 'gpt-5',
      displayName: 'GPT-5',
      enabled: true,
    });
    const candidate = await repo.createCandidate({
      publicModelId: model.id,
      upstreamKeyId: upstream.id,
      realModelName: 'gpt-5-prod',
      enabled: true,
    });
    const withCandidates = await repo.findWithCandidates(model.id);
    expect(withCandidates!.candidates).toHaveLength(1);
    expect(withCandidates!.candidates[0]!.id).toBe(candidate.id);
  });

  it('deletes public model and cleans target namespace in transaction', async () => {
    const model = await repo.createPublicModel({ name: 'claude-x', enabled: true });
    await targetRepo.createTargetName({
      name: 'claude-x',
      targetType: 'public_model',
      targetId: model.id,
    });
    await repo.deletePublicModel(model.id);
    expect(await repo.findById(model.id)).toBeUndefined();
    expect(await targetRepo.findByName('claude-x')).toBeUndefined();
  });
});
