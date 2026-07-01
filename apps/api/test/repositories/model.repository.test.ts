import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ModelRepository } from '../../src/infrastructure/db/repositories/model.repository.js';
import { ProviderAccountRepository } from '../../src/infrastructure/db/repositories/provider-account.repository.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import { EndpointRepository } from '../../src/infrastructure/db/repositories/endpoint.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('model repository', () => {
  let testDb: TestDb;
  let repo: ModelRepository;
  let providerAccountRepo: ProviderAccountRepository;
  let targetRepo: TargetRepository;
  let endpointRepo: EndpointRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new ModelRepository(testDb.db);
    providerAccountRepo = new ProviderAccountRepository(testDb.db);
    targetRepo = new TargetRepository(testDb.db);
    endpointRepo = new EndpointRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('creates model with candidates', async () => {
    const account = await providerAccountRepo.createProviderAccount({
      name: 'Provider',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com',
      authType: 'pat',
      apiKeyCiphertext: 'enc',
      apiKeyPrefix: 'sk-',
    });
    // v1 收口：candidate 必须绑定 endpoint。repo-level 测试绕过 service，
    // 手工建一个 endpoint。
    const endpoint = await endpointRepo.create({
      providerAccountId: account.id,
      protocol: 'openai',
      baseUrl: 'https://api.openai.com',
      providerType: 'openai_compatible',
      capabilitiesJson: [],
    });
    const model = await repo.createModel({
      name: 'gpt-5',
      displayName: 'GPT-5',
      enabled: true,
    });
    const candidate = await repo.createCandidate({
      modelId: model.id,
      providerAccountId: account.id,
      endpointId: endpoint.id,
      realModelName: 'gpt-5-prod',
      enabled: true,
    });
    const withCandidates = await repo.findWithCandidates(model.id);
    expect(withCandidates!.candidates).toHaveLength(1);
    expect(withCandidates!.candidates[0]!.id).toBe(candidate.id);
  });

  it('deletes model and cleans target namespace in transaction', async () => {
    const model = await repo.createModel({ name: 'claude-x', enabled: true });
    await targetRepo.createTargetName({
      name: 'claude-x',
      targetType: 'model',
      targetId: model.id,
    });
    await repo.deleteModel(model.id);
    expect(await repo.findById(model.id)).toBeUndefined();
    expect(await targetRepo.findByName('claude-x')).toBeUndefined();
  });
});
