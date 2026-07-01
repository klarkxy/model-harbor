import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../src/server/build-server.js';
import { createTestDb } from '../../../src/infrastructure/db/test-helper.js';
import { loginAsAdmin } from '../../helpers/auth.js';
import type { TestDb } from '../../../src/infrastructure/db/test-helper.js';

describe('admin plan routes', () => {
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

  it('creates and lists plans', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/costs/plans',
      cookies: { session: cookie },
      payload: {
        planType: 'token',
        name: '月度 Token 包',
        providerType: 'openai_compatible',
        totalAmount: 1_000_000,
        unit: 'token',
        period: 'monthly',
        purchasedAt: new Date().toISOString(),
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(create.statusCode).toBe(200);
    const created = create.json().data;
    expect(created.remainingAmount).toBe(1_000_000);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/costs/plans',
      cookies: { session: cookie },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.data.some((p: { id: string }) => p.id === created.id)).toBe(true);
  });

  it('updates and deletes a plan', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/costs/plans',
      cookies: { session: cookie },
      payload: {
        planType: 'coding',
        name: 'Coding 包',
        totalAmount: 100,
        unit: 'request',
        period: 'one_time',
        purchasedAt: new Date().toISOString(),
        validFrom: new Date().toISOString(),
      },
    });
    const id = create.json().data.id;

    const update = await app.inject({
      method: 'PUT',
      url: `/api/admin/costs/plans/${id}`,
      cookies: { session: cookie },
      payload: { totalAmount: 200 },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data.totalAmount).toBe(200);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/costs/plans/${id}`,
      cookies: { session: cookie },
    });
    expect(del.statusCode).toBe(200);
  });
});
