import { describe, it, expect } from 'vitest';
import { parseRetryAfterHeader } from '../../src/gateway/retry-after.js';

describe('parseRetryAfterHeader', () => {
  it('parses integer seconds', () => {
    expect(parseRetryAfterHeader('120')).toBe(120_000);
  });

  it('parses decimal seconds to ms', () => {
    expect(parseRetryAfterHeader('1.5')).toBe(1_500);
  });

  it('parses HTTP-date', () => {
    const now = new Date('2025-01-01T00:00:00.000Z');
    const header = 'Wed, 01 Jan 2025 00:02:00 GMT';
    expect(parseRetryAfterHeader(header, now)).toBe(120_000);
  });

  it('returns 0 for past HTTP-date', () => {
    const now = new Date('2025-01-01T00:00:00.000Z');
    const header = 'Tue, 31 Dec 2024 23:59:00 GMT';
    expect(parseRetryAfterHeader(header, now)).toBe(0);
  });

  it('returns undefined for empty or invalid values', () => {
    expect(parseRetryAfterHeader(undefined)).toBeUndefined();
    expect(parseRetryAfterHeader('')).toBeUndefined();
    expect(parseRetryAfterHeader('not-a-number')).toBeUndefined();
  });
});
