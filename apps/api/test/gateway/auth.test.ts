import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server/build-server.js';
import { createTestDb, type TestDb } from '../../src/infrastructure/db/test-helper.js';
import { ClientService } from '../../src/application/client.service.js';

describe('gateway auth', () => {
  let app: FastifyInstance;
  let testDb: TestDb;
  let rawKey: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildServer({
      disableBackgroundJobs: true,
      logger: false,
      databaseUrl: `file:${testDb.filePath}`,
    });

    const clientService = new ClientService(testDb.db);
    const result = await clientService.createClient({
      name: 'Gateway Test App',
      enabled: true,
    });
    rawKey = result.rawKey;
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('allows request with Authorization: Bearer ck_...', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${rawKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.object).toBe('list');
  });

  it('allows request with x-api-key header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { 'x-api-key': rawKey },
    });
    expect(res.statusCode).toBe(200);
  });

  it('prefers Authorization over x-api-key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${rawKey}`, 'x-api-key': 'invalid' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects missing key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.payload);
    expect(body.error.type).toBe('AuthenticationError');
  });

  it('rejects invalid key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: 'Bearer ck_invalid' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects revoked key', async () => {
    const clientService = new ClientService(testDb.db);
    const { client, rawKey: revokedRawKey } = await clientService.createClient({
      name: 'Revoked App',
      enabled: true,
    });

    await clientService.revokeActiveKeyByClient(client.id);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${revokedRawKey}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects key from disabled app', async () => {
    const clientService = new ClientService(testDb.db);
    const { rawKey: disabledRawKey } = await clientService.createClient({
      name: 'Disabled App',
      enabled: false,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${disabledRawKey}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
