import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEnv, resetEnvForTests } from '../src/config/env.js';

describe('createEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnvForTests();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MYLLM_') || key.startsWith('MANAGE_YOUR_LLM_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    resetEnvForTests();
    process.env = { ...originalEnv };
  });

  it('uses defaults in development', () => {
    process.env['NODE_ENV'] = 'development';
    const env = createEnv();
    expect(env.PORT).toBe(5420);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.PUBLIC_BASE_URL).toBe('http://localhost:5420');
  });

  it('reads MYLLM_PORT', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['MYLLM_PORT'] = '9000';
    const env = createEnv();
    expect(env.PORT).toBe(9000);
    expect(env.PUBLIC_BASE_URL).toBe('http://localhost:9000');
  });

  it('reads MANAGE_YOUR_LLM_PORT as fallback', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['MANAGE_YOUR_LLM_PORT'] = '8000';
    const env = createEnv();
    expect(env.PORT).toBe(8000);
  });

  it('rejects default SECRET_KEY in production', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => createEnv()).toThrow(/SECRET_KEY/);
  });

  it('accepts custom SECRET_KEY in production', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['MYLLM_SECRET_KEY'] = 'not-default';
    const env = createEnv();
    expect(env.SECRET_KEY).toBe('not-default');
  });

  it('rejects invalid port', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['MYLLM_PORT'] = 'not-a-number';
    expect(() => createEnv()).toThrow(/Invalid number/);
  });
});
