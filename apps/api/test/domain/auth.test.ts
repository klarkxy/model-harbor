import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/domain/auth/password.js';
import {
  generateSessionId,
  issueSessionToken,
  verifySessionToken,
  hashSessionId,
} from '../../src/domain/auth/session.js';

describe('password', () => {
  it('hashes and verifies password', () => {
    const hash = hashPassword('my-secret-password');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('my-secret-password', hash)).toBe(true);
    expect(verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('rejects malformed stored hash', () => {
    expect(verifyPassword('password', 'not-a-hash')).toBe(false);
  });
});

describe('session', () => {
  it('issues and verifies session token', () => {
    const secret = 'app-secret';
    const sessionId = generateSessionId();
    const token = issueSessionToken(sessionId, secret);
    expect(verifySessionToken(token, secret)).toBe(sessionId);
    expect(verifySessionToken(token, 'wrong-secret')).toBeNull();
    expect(verifySessionToken('invalid-token', secret)).toBeNull();
  });

  it('hashes session id deterministically', () => {
    const id = generateSessionId();
    expect(hashSessionId(id)).toBe(hashSessionId(id));
    expect(hashSessionId(id)).not.toBe(id);
  });
});
