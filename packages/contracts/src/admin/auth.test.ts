import { describe, it, expect } from 'vitest';
import {
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  logoutResponseSchema,
} from './auth.js';

describe('auth contracts', () => {
  it('accepts valid login request', () => {
    const parsed = loginRequestSchema.parse({ username: 'admin', password: 'secret' });
    expect(parsed.username).toBe('admin');
  });

  it('rejects empty login request', () => {
    expect(() => loginRequestSchema.parse({ username: '', password: '' })).toThrow();
  });

  it('accepts login response', () => {
    const parsed = loginResponseSchema.parse({
      data: { admin: { id: 'adm_1', username: 'admin', displayName: 'Admin' } },
    });
    expect(parsed.data.admin.username).toBe('admin');
  });

  it('accepts me response', () => {
    const parsed = meResponseSchema.parse({
      data: { admin: { id: 'adm_1', username: 'admin', displayName: 'Admin' } },
    });
    expect(parsed.data.admin.displayName).toBe('Admin');
  });

  it('accepts logout response', () => {
    const parsed = logoutResponseSchema.parse({ data: { ok: true } });
    expect(parsed.data.ok).toBe(true);
  });
});
