import { describe, it, expect } from 'vitest';
import {
  assertTargetName,
  assertProviderType,
  assertSourceProtocol,
  assertQuotaPeriod,
  assertPositiveInt,
  encryptUpstreamApiKey,
  decryptUpstreamApiKey,
  generateConsumerKeyRaw,
  safeJsonString,
  parseJsonArray,
  parseJsonRecord,
  parseJsonObject,
} from '../src/modules/admin/helpers.js';
import { ValidationError } from '@modelharbor/shared';

const SECRET = 'a'.repeat(64);

describe('admin helpers', () => {
  describe('assertTargetName', () => {
    it('accepts valid names', () => {
      expect(() => assertTargetName('valid-name_1.0')).not.toThrow();
    });

    it('rejects empty', () => {
      expect(() => assertTargetName('')).toThrow(ValidationError);
    });

    it('rejects names longer than 128 chars', () => {
      expect(() => assertTargetName('a'.repeat(129))).toThrow(/too long/);
    });

    it('rejects names with invalid characters', () => {
      expect(() => assertTargetName('has space')).toThrow(/[a-zA-Z0-9._-]+/);
      expect(() => assertTargetName('with/slash')).toThrow();
    });
  });

  describe('assertProviderType', () => {
    it('accepts known provider types', () => {
      expect(() => assertProviderType('openai_compatible')).not.toThrow();
      expect(() => assertProviderType('coze')).not.toThrow();
    });

    it('rejects unknown provider types', () => {
      expect(() => assertProviderType('unknown_provider')).toThrow(/providerType/);
    });
  });

  describe('assertSourceProtocol', () => {
    it('accepts known protocols', () => {
      expect(() => assertSourceProtocol('openai')).not.toThrow();
      expect(() => assertSourceProtocol('anthropic')).not.toThrow();
    });

    it('rejects unknown protocols', () => {
      expect(() => assertSourceProtocol('not-a-protocol')).toThrow(/protocol/);
    });
  });

  describe('assertQuotaPeriod', () => {
    it('accepts each known period', () => {
      for (const p of ['hour', 'day', 'week', 'month', 'total']) {
        expect(() => assertQuotaPeriod(p)).not.toThrow();
      }
    });

    it('rejects unknown periods', () => {
      expect(() => assertQuotaPeriod('decade')).toThrow(/period/);
    });
  });

  describe('assertPositiveInt', () => {
    it('returns null for undefined and null', () => {
      expect(assertPositiveInt('x', undefined)).toBeNull();
      expect(assertPositiveInt('x', null)).toBeNull();
    });

    it('returns the integer when valid', () => {
      expect(assertPositiveInt('x', 0)).toBe(0);
      expect(assertPositiveInt('x', 42)).toBe(42);
    });

    it('rejects negative numbers', () => {
      expect(() => assertPositiveInt('x', -1)).toThrow(/non-negative/);
    });

    it('rejects non-integers', () => {
      expect(() => assertPositiveInt('x', 1.5)).toThrow(/non-negative/);
    });

    it('rejects non-numbers', () => {
      expect(() => assertPositiveInt('x', '3')).toThrow(/non-negative/);
    });

    it('rejects numbers above the max', () => {
      expect(() => assertPositiveInt('x', 2 ** 31, 100)).toThrow(/non-negative/);
    });
  });

  describe('encryptUpstreamApiKey / decryptUpstreamApiKey', () => {
    it('round-trips an api key', () => {
      const enc = encryptUpstreamApiKey('sk-test-12345678', SECRET);
      expect(enc.prefix).toBe('sk-t');
      expect(enc.ciphertext).toBeTruthy();
      expect(decryptUpstreamApiKey(enc.ciphertext, SECRET)).toBe('sk-test-12345678');
    });

    it('rejects empty input', () => {
      expect(() => encryptUpstreamApiKey('', SECRET)).toThrow(/apiKey/);
    });
  });

  describe('generateConsumerKeyRaw', () => {
    it('returns the expected shape', () => {
      const out = generateConsumerKeyRaw();
      expect(out.raw).toMatch(/^mh_/);
      expect(out.prefix.length).toBe(7);
      expect(out.suffix.length).toBe(7);
      expect(out.hash.length).toBeGreaterThan(0);
    });

    it('produces unique raw keys', () => {
      const a = generateConsumerKeyRaw();
      const b = generateConsumerKeyRaw();
      expect(a.raw).not.toBe(b.raw);
      expect(a.hash).not.toBe(b.hash);
    });
  });

  describe('safeJsonString', () => {
    it('returns a JSON string for valid values', () => {
      expect(safeJsonString({ a: 1 }, '{}')).toBe('{"a":1}');
    });

    it('returns the fallback when JSON.stringify throws (circular)', () => {
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      expect(safeJsonString(obj, '"fallback"')).toBe('"fallback"');
    });

    it('falls back when given null and a non-json fallback', () => {
      // JSON.parse('not-json') throws, so fallback returned
      expect(safeJsonString(null, 'not-json')).toBe('not-json');
    });
  });

  describe('parseJsonArray', () => {
    it('returns [] for null and empty string', () => {
      expect(parseJsonArray(null)).toEqual([]);
      expect(parseJsonArray('')).toEqual([]);
    });

    it('parses a string array', () => {
      expect(parseJsonArray('["a","b"]')).toEqual(['a', 'b']);
    });

    it('rejects mixed-type arrays', () => {
      expect(parseJsonArray('["a",1]')).toEqual([]);
    });

    it('rejects non-array JSON', () => {
      expect(parseJsonArray('{"a":1}')).toEqual([]);
    });

    it('returns [] on invalid JSON', () => {
      expect(parseJsonArray('not json')).toEqual([]);
    });
  });

  describe('parseJsonRecord', () => {
    it('returns null for null/empty input', () => {
      expect(parseJsonRecord(null)).toBeNull();
      expect(parseJsonRecord('')).toBeNull();
    });

    it('parses object JSON', () => {
      expect(parseJsonRecord('{"a":1}')).toEqual({ a: 1 });
    });

    it('rejects arrays', () => {
      expect(parseJsonRecord('[]')).toBeNull();
    });

    it('returns null on invalid JSON', () => {
      expect(parseJsonRecord('not json')).toBeNull();
    });
  });

  describe('parseJsonObject', () => {
    it('returns {} for null/empty input', () => {
      expect(parseJsonObject(null)).toEqual({});
      expect(parseJsonObject('')).toEqual({});
    });

    it('keeps only string values', () => {
      expect(parseJsonObject('{"a":"x","b":1,"c":null}')).toEqual({ a: 'x' });
    });

    it('returns {} for arrays', () => {
      expect(parseJsonObject('[]')).toEqual({});
    });

    it('returns {} on invalid JSON', () => {
      expect(parseJsonObject('not json')).toEqual({});
    });
  });
});
