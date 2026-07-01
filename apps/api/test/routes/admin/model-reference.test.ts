import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../src/server/build-server.js';
import { createTestDb } from '../../../src/infrastructure/db/test-helper.js';
import { ModelReferenceRepository } from '../../../src/infrastructure/db/repositories/model-reference.repository.js';
import { loginAsAdmin } from '../../helpers/auth.js';
import type { TestDb } from '../../../src/infrastructure/db/test-helper.js';

import type { ModelReferenceEntryInput } from '../../../src/infrastructure/model-reference/arena-client.js';

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

describe('admin model reference routes', () => {
  let app: FastifyInstance;
  let testDb: TestDb;
  let cookie: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildServer({
      db: testDb.db,
      client: testDb.client,
      disableBackgroundJobs: true,
      logger: false,
    });

    cookie = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists model reference entries', async () => {
    const repo = new ModelReferenceRepository(testDb.db);
    await repo.upsertEntry(makeEntry('route-model'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/model-reference',
      cookies: { session: cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(
      body.data.some(
        (e: { normalizedModelName: string }) => e.normalizedModelName === 'route-model',
      ),
    ).toBe(true);
  });

  it('refreshes model reference entries with mocked client', async () => {
    const module = await import('../../../src/infrastructure/model-reference/arena-client.js');
    const fetchSpy = vi
      .spyOn(module.ArenaModelReferenceClient.prototype, 'fetch')
      .mockResolvedValue([makeEntry('mock-model')]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/model-reference/refresh',
      cookies: { session: cookie },
      payload: { force: true },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.success).toBe(true);

    fetchSpy.mockRestore();
  });

  it('recommends draft from selected entries', async () => {
    const repo = new ModelReferenceRepository(testDb.db);
    await repo.upsertEntry(makeEntry('draft-model'));
    const entry = (await repo.listEntriesBySource('global', 'arena')).find(
      (e) => e.normalizedModelName === 'draft-model',
    )!;

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/model-reference/recommend',
      cookies: { session: cookie },
      payload: { entryIds: [entry.id], providerAccountId: 'uk_1' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.models).toHaveLength(1);
    expect(body.data.models[0].name).toBe('draft-model');
  });
});
