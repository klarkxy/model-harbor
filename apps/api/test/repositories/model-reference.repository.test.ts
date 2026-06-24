import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ModelReferenceRepository } from '../../src/infrastructure/db/repositories/model-reference.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('model reference repository', () => {
  let testDb: TestDb;
  let repo: ModelReferenceRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new ModelReferenceRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('upserts entry by normalized model name', async () => {
    await repo.upsertEntry({
      region: 'global',
      source: 'rele',
      normalizedModelName: 'gpt-4o',
      sourceModelId: 'gpt-4o-2024-08-06',
      displayName: 'GPT-4o',
      provider: 'openai',
      scoresJson: { quality: 90 },
      priceJson: { input: 5, output: 15 },
      fetchedAt: new Date(),
    });
    await repo.upsertEntry({
      region: 'global',
      source: 'rele',
      normalizedModelName: 'gpt-4o',
      sourceModelId: 'gpt-4o-2024-08-06',
      displayName: 'GPT-4o Updated',
      provider: 'openai',
      scoresJson: { quality: 92 },
      priceJson: { input: 5, output: 15 },
      fetchedAt: new Date(),
    });
    const entries = await repo.listEntriesByNormalizedName('gpt-4o');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.displayName).toBe('GPT-4o Updated');
  });

  it('upserts sync status', async () => {
    await repo.upsertSyncStatus({
      region: 'global',
      source: 'rele',
      status: 'success',
      ttlMs: 86400000,
    });
    const status = await repo.getSyncStatus('global', 'rele');
    expect(status!.status).toBe('success');
  });
});
