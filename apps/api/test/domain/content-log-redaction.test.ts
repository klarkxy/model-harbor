import { describe, it, expect } from 'vitest';
import { redactAndTruncate } from '../../src/domain/observability/content-log-redaction.js';

describe('content-log-redaction', () => {
  it('returns primitives unchanged', () => {
    expect(redactAndTruncate(42, 1000)).toBe(42);
    expect(redactAndTruncate(true, 1000)).toBe(true);
    expect(redactAndTruncate(null, 1000)).toBe(null);
  });

  it('redacts consumer keys and api keys in strings', () => {
    const input = {
      key: 'ck_abc123',
      other: 'Here is sk-secretkey and also mh_token123',
      header: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    };
    const result = redactAndTruncate(input, 10000) as Record<string, string>;
    expect(result.key).toBe('[REDACTED]');
    expect(result.other).toBe('Here is [REDACTED] and also [REDACTED]');
    expect(result.header).toBe('Authorization: [REDACTED]');
  });

  it('redacts values for sensitive header keys', () => {
    const input = {
      headers: {
        Authorization: 'secret',
        'x-api-key': 'secret',
        'api-key': 'secret',
        normal: 'visible',
      },
    };
    const result = redactAndTruncate(input, 10000) as { headers: Record<string, string> };
    expect(result.headers.Authorization).toBe('[REDACTED]');
    expect(result.headers['x-api-key']).toBe('[REDACTED]');
    expect(result.headers['api-key']).toBe('[REDACTED]');
    expect(result.headers.normal).toBe('visible');
  });

  it('truncates long strings by bytes', () => {
    const input = 'a'.repeat(2000);
    const result = redactAndTruncate(input, 100);
    expect(typeof result).toBe('string');
    const encoder = new TextEncoder();
    expect(encoder.encode(result).length).toBeLessThanOrEqual(100);
    expect(result).toContain('…');
  });

  it('truncates entire payload when serialized exceeds max bytes', () => {
    const input = { data: 'a'.repeat(5000) };
    const result = redactAndTruncate(input, 100) as { _truncated: boolean; preview: string };
    expect(result._truncated).toBe(true);
    expect(typeof result.preview).toBe('string');
    expect(new TextEncoder().encode(result.preview).length).toBeLessThanOrEqual(100);
  });

  it('returns null when maxBytes is zero or negative', () => {
    expect(redactAndTruncate({ x: 1 }, 0)).toBe(null);
    expect(redactAndTruncate({ x: 1 }, -10)).toBe(null);
  });
});
