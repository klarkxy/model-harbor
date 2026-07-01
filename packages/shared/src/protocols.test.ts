import { describe, it, expect } from 'vitest';
import {
  ALL_PROVIDER_TYPES,
  ALL_SOURCE_PROTOCOLS,
  PROTOCOL_BY_PROVIDER,
  protocolFor,
} from './protocols.js';

describe('protocols', () => {
  it('lists all provider types', () => {
    expect(ALL_PROVIDER_TYPES.length).toBeGreaterThan(0);
    expect(new Set(ALL_PROVIDER_TYPES).size).toBe(ALL_PROVIDER_TYPES.length);
  });

  it('lists all source protocols', () => {
    expect(ALL_SOURCE_PROTOCOLS).toContain('anthropic');
    expect(ALL_SOURCE_PROTOCOLS).toContain('openai');
    expect(ALL_SOURCE_PROTOCOLS).toContain('codex');
  });

  it('maps every provider type to a source protocol', () => {
    for (const pt of ALL_PROVIDER_TYPES) {
      expect(ALL_SOURCE_PROTOCOLS).toContain(protocolFor(pt));
      expect(PROTOCOL_BY_PROVIDER[pt]).toBe(protocolFor(pt));
    }
  });
});
