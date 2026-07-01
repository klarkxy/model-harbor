import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server/build-server.js';
import type { FastifyInstance } from 'fastify';

describe('buildServer', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({
      disableBackgroundJobs: true,
      logger: false,
      databaseUrl: ':memory:',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('can build and close the app', async () => {
    expect(app.server).toBeTruthy();
  });
});
