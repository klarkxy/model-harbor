import { describe, expect, it } from 'vitest';
import { ALL_PROVIDER_TYPES, ALL_SOURCE_PROTOCOLS } from '../protocols.js';
import { getProviderDescriptor, listProviderDescriptors, PROVIDER_PRESETS } from './presets.js';
import { opencodeGoEndpointProtocolForModel } from './opencode-go.js';

describe('provider registry presets', () => {
  it('has at least one preset', () => {
    expect(PROVIDER_PRESETS.length).toBeGreaterThan(0);
  });

  it('lists all presets in display-name order', () => {
    const listed = listProviderDescriptors();
    expect(listed.length).toBe(PROVIDER_PRESETS.length);
    for (let i = 1; i < listed.length; i++) {
      const prev = listed[i - 1]!.metadata.displayName;
      const cur = listed[i]!.metadata.displayName;
      expect(prev.localeCompare(cur)).toBeLessThanOrEqual(0);
    }
  });

  it('has unique ids', () => {
    const ids = PROVIDER_PRESETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every descriptor has required fields', () => {
    for (const d of PROVIDER_PRESETS) {
      expect(d.id, 'id').toBeTruthy();
      expect(d.metadata.displayName, `displayName for ${d.id}`).toBeTruthy();
      expect(d.capabilities, `capabilities for ${d.id}`).toBeTruthy();
      expect(d.endpoints.length, `endpoints for ${d.id}`).toBeGreaterThan(0);
    }
  });

  it('every endpoint uses a valid protocol and provider type', () => {
    for (const d of PROVIDER_PRESETS) {
      for (const ep of d.endpoints) {
        expect(
          ALL_SOURCE_PROTOCOLS.includes(ep.protocol),
          `${d.id} endpoint protocol ${ep.protocol}`,
        ).toBe(true);
        expect(
          ALL_PROVIDER_TYPES.includes(ep.providerType),
          `${d.id} endpoint providerType ${ep.providerType}`,
        ).toBe(true);
      }
    }
  });

  it('capabilities protocols match endpoint protocols', () => {
    for (const d of PROVIDER_PRESETS) {
      const endpointProtocols = new Set(d.endpoints.map((e) => e.protocol));
      expect(new Set(d.capabilities.protocols), `${d.id} capabilities.protocols`).toEqual(
        endpointProtocols,
      );
    }
  });

  it('authStrategies.available contains the default when declared', () => {
    for (const d of PROVIDER_PRESETS) {
      if (!d.authStrategies) continue;
      expect(d.authStrategies.available.length, `${d.id} available strategies`).toBeGreaterThan(0);
      expect(
        d.authStrategies.available.includes(d.authStrategies.default),
        `${d.id} default strategy in available`,
      ).toBe(true);
    }
  });

  it('looks up descriptors by id', () => {
    for (const d of PROVIDER_PRESETS) {
      expect(getProviderDescriptor(d.id)).toBe(d);
    }
    expect(getProviderDescriptor('nonexistent')).toBeUndefined();
  });

  it('maps OpenCode Go models to their documented upstream protocols', () => {
    expect(opencodeGoEndpointProtocolForModel('deepseek-v4-flash')).toBe('openai');
    expect(opencodeGoEndpointProtocolForModel('opencode-go/kimi-k2.7-code')).toBe('openai');
    expect(opencodeGoEndpointProtocolForModel('minimax-m3')).toBe('anthropic');
    expect(opencodeGoEndpointProtocolForModel('qwen3.7-plus')).toBe('anthropic');
    expect(opencodeGoEndpointProtocolForModel('future-model')).toBeNull();
  });

  it('sets default User-Agent headers for Coding and OpenCode Go presets only', () => {
    for (const id of ['kimi-code', 'opencode-go']) {
      expect(getProviderDescriptor(id)?.defaultExtraHeaders?.['User-Agent'], id).toBe(
        'ModelHarbor/0.1',
      );
    }
    expect(
      getProviderDescriptor('moonshot-cn')?.defaultExtraHeaders?.['User-Agent'],
    ).toBeUndefined();
    expect(getProviderDescriptor('moonshot')?.defaultExtraHeaders?.['User-Agent']).toBeUndefined();
  });
});
