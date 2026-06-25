import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ModelReferenceService } from '../../src/application/model-reference.service.js';
import { ModelReferenceRepository } from '../../src/infrastructure/db/repositories/model-reference.repository.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';
import type { ModelReferenceSourceClient } from '../../src/infrastructure/model-reference/arena-client.js';
import type { ModelReferenceRegion } from '../../src/infrastructure/db/schema.js';
import type { ModelReferenceEntryInput } from '../../src/infrastructure/model-reference/arena-client.js';

function makeEntry(model: string): ModelReferenceEntryInput {
  return {
    region: 'global',
    source: 'arena',
    normalizedModelName: model.toLowerCase(),
    sourceModelId: model,
    displayName: model,
    provider: 'OpenAI',
    scoresJson: { arenaElo: 1500, rank: 1, ci: 5, votes: 1000 },
    priceJson: {},
    contextWindow: null,
    latencyMs: null,
    speedScore: null,
    sourceUrl: 'https://arena.ai',
    rawJson: {},
    fetchedAt: new Date(),
  };
}

describe('ModelReferenceService', () => {
  let testDb: TestDb;
  let service: ModelReferenceService;
  let client: ModelReferenceSourceClient;

  beforeEach(async () => {
    testDb = await createTestDb();
    client = {
      fetch: vi.fn().mockResolvedValue([makeEntry('gpt-5'), makeEntry('claude-5')]),
    };
    service = new ModelReferenceService(testDb.db, client as ModelReferenceSourceClient);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('refreshes entries and updates sync status', async () => {
    const result = await service.refresh('global' as ModelReferenceRegion, 'arena');
    expect(result.success).toBe(true);

    const entries = await new ModelReferenceRepository(testDb.db).listEntriesBySource('global', 'arena');
    expect(entries).toHaveLength(2);

    const status = await new ModelReferenceRepository(testDb.db).getSyncStatus('global', 'arena');
    expect(status?.status).toBe('success');
    expect(status?.lastRefreshAt).not.toBeNull();
    expect(status?.nextRefreshAfter).not.toBeNull();
  });

  it('keeps old entries when refresh fails', async () => {
    await service.refresh('global' as ModelReferenceRegion, 'arena');
    vi.mocked(client.fetch).mockRejectedValue(new Error('network error'));

    const result = await service.refresh('global' as ModelReferenceRegion, 'arena', true);
    expect(result.success).toBe(false);
    expect(result.error).toContain('network error');

    const entries = await new ModelReferenceRepository(testDb.db).listEntriesBySource('global', 'arena');
    expect(entries).toHaveLength(2);

    const status = await new ModelReferenceRepository(testDb.db).getSyncStatus('global', 'arena');
    expect(status?.status).toBe('error');
  });

  it('skips refresh when TTL has not expired', async () => {
    await service.refresh('global' as ModelReferenceRegion, 'arena');
    vi.mocked(client.fetch).mockClear();

    const result = await service.refresh('global' as ModelReferenceRegion, 'arena');
    expect(result.success).toBe(true);
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('forces refresh even when TTL has not expired', async () => {
    await service.refresh('global' as ModelReferenceRegion, 'arena');

    const result = await service.refresh('global' as ModelReferenceRegion, 'arena', true);
    expect(result.success).toBe(true);
    expect(client.fetch).toHaveBeenCalledTimes(2);
  });

  it('lists and sorts entries', async () => {
    await service.refresh('global' as ModelReferenceRegion, 'arena');
    const entries = await service.listEntries({
      region: 'global',
      source: 'arena',
      sortBy: 'score',
      order: 'desc',
    });
    expect(entries).toHaveLength(2);
  });

  it('recommends public model drafts and detects name conflicts', async () => {
    await service.refresh('global' as ModelReferenceRegion, 'arena');
    const entries = await new ModelReferenceRepository(testDb.db).listEntriesBySource('global', 'arena');
    const entryIds = entries.map((e) => e.id);

    await new TargetRepository(testDb.db).createTargetName({
      name: 'gpt-5',
      targetType: 'public_model',
      targetId: 'pm_existing',
    });

    const draft = await service.recommendDraft({ entryIds, upstreamKeyId: 'uk_1', createGroup: true });
    expect(draft.publicModels).toHaveLength(2);
    expect(draft.publicModels[0]!.nameConflict || draft.publicModels[1]!.nameConflict).toBe(true);
    expect(draft.conflicts.length).toBeGreaterThan(0);
    expect(draft.modelGroup).toBeDefined();
    expect(draft.modelGroup!.members).toHaveLength(2);
  });
});
