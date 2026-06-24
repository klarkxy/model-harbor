import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server/build-server.js';
import { AuthenticationError, ValidationError, TargetNotFoundError } from '@manageyourllm/shared';
import type { FastifyInstance } from 'fastify';

describe('error handler', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({
      disableBackgroundJobs: true,
      logger: false,
      databaseUrl: ':memory:',
    });
    app.get('/auth-error', async () => {
      throw new AuthenticationError('bad credentials');
    });
    app.get('/validation-error', async () => {
      throw new ValidationError('bad input');
    });
    app.get('/target-error', async () => {
      throw new TargetNotFoundError('missing');
    });
    app.get('/unknown-error', async () => {
      throw new Error('boom');
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('maps AuthenticationError to 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth-error' });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('authentication_error');
  });

  it('maps ValidationError to 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/validation-error' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('validation_error');
  });

  it('maps TargetNotFoundError to 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/target-error' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('target_not_found');
  });

  it('maps unknown errors to 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/unknown-error' });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('internal_error');
  });
});
