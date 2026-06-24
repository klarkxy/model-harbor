import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { buildServer } from '../src/server/build-server.js';
import { healthRoutes } from '../src/server/plugins/health.js';
import type { FastifyInstance } from 'fastify';

describe('health routes', () => {
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

  it('/healthz returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'ok' });
  });

  it('/readyz returns ok when database is wired', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'ok' });
  });
});

describe('readyz with database', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('returns ok when SELECT 1 succeeds', async () => {
    app = Fastify({ logger: false });
    await app.register(healthRoutes, {
      db: { get: async () => ({ 1: 1 }) },
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'ok' });
  });

  it('returns degraded when SELECT 1 fails', async () => {
    app = Fastify({ logger: false });
    await app.register(healthRoutes, {
      db: { get: async () => Promise.reject(new Error('db down')) },
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload) as { status: string; error?: string };
    expect(body.status).toBe('degraded');
    expect(body.error).toBe('db down');
  });
});
