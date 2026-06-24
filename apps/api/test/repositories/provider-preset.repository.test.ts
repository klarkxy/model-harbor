import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ProviderPresetRepository } from '../../src/infrastructure/db/repositories/provider-preset.repository.js';
import type { ProviderDescriptor } from '@manageyourllm/shared';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

const DESCRIPTOR: ProviderDescriptor = {
  id: 'custom-test',
  metadata: { displayName: 'Custom Test' },
  capabilities: {
    protocols: ['openai'],
    supportsTools: false,
    supportsToolChoice: false,
    supportsVision: false,
    supportsJsonMode: false,
    supportsThinking: false,
  },
  endpoints: [
    { protocol: 'openai', baseUrl: 'https://example.com', providerType: 'openai_compatible' },
  ],
};

describe('provider preset repository', () => {
  let testDb: TestDb;
  let repo: ProviderPresetRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new ProviderPresetRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('lists built-in presets from shared package', () => {
    const builtins = repo.listBuiltins();
    expect(builtins.length).toBeGreaterThan(0);
    expect(builtins.some((p) => p.id === 'openai')).toBe(true);
  });

  it('CRUD local custom preset without storing secret', async () => {
    const created = await repo.createLocal({
      name: 'My Preset',
      providerType: 'openai_compatible',
      descriptorJson: DESCRIPTOR,
    });
    expect(created.source).toBe('local');

    const all = await repo.listAll();
    expect(all.some((p) => p.id === created.id)).toBe(true);

    const updated = await repo.updateLocal(created.id, {
      descriptorJson: { ...DESCRIPTOR, metadata: { displayName: 'Updated' } },
    });
    expect(updated!.descriptorJson.metadata.displayName).toBe('Updated');

    await repo.deleteLocal(created.id);
    expect(await repo.findLocalById(created.id)).toBeUndefined();
  });
});
