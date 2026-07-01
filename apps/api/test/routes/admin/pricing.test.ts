import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../src/server/build-server.js';
import { createTestDb } from '../../../src/infrastructure/db/test-helper.js';
import { loginAsAdmin } from '../../helpers/auth.js';
import type { TestDb } from '../../../src/infrastructure/db/test-helper.js';

describe('admin pricing routes', () => {
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

  it('creates and lists pricing entries', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/costs/pricing',
      cookies: { session: cookie },
      payload: {
        providerType: 'openai_compatible',
        realModelName: 'gpt-4o',
        inputPricePer1k: 5,
        outputPricePer1k: 15,
        currency: 'USD',
        effectiveFrom: new Date().toISOString(),
      },
    });
    expect(create.statusCode).toBe(200);
    const created = create.json().data;
    expect(created.inputPricePer1k).toBe(5);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/costs/pricing',
      cookies: { session: cookie },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.data.some((e: { id: string }) => e.id === created.id)).toBe(true);
  });

  it('updates and deletes a pricing entry', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/costs/pricing',
      cookies: { session: cookie },
      payload: {
        providerType: 'openai_compatible',
        realModelName: 'gpt-3.5',
        inputPricePer1k: 1,
        outputPricePer1k: 2,
        effectiveFrom: new Date().toISOString(),
      },
    });
    const id = create.json().data.id;

    const update = await app.inject({
      method: 'PUT',
      url: `/api/admin/costs/pricing/${id}`,
      cookies: { session: cookie },
      payload: { inputPricePer1k: 3 },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data.inputPricePer1k).toBe(3);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/costs/pricing/${id}`,
      cookies: { session: cookie },
    });
    expect(del.statusCode).toBe(200);
  });
});
