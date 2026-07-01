import { describe, it, expect } from 'vitest';
import { ProviderPresetRepository } from '../../src/infrastructure/db/repositories/provider-preset.repository.js';

describe('provider preset repository', () => {
  it('lists built-in presets from shared package', () => {
    const repo = new ProviderPresetRepository();
    const presets = repo.listPresets();
    expect(presets.length).toBeGreaterThan(0);
    expect(presets.every((p) => p.source === 'builtin')).toBe(true);
    expect(presets.some((p) => p.id === 'openai')).toBe(true);
  });

  it('finds built-in preset by id', () => {
    const repo = new ProviderPresetRepository();
    expect(repo.findById('openai')).toBeDefined();
    expect(repo.findById('unknown')).toBeUndefined();
  });
});
