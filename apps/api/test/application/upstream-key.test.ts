import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { UpstreamKeyRepository } from '../../src/infrastructure/db/repositories/upstream-key.repository.js';
import { UpstreamKeyService } from '../../src/application/upstream-key.service.js';
import { decryptSecret } from '../../src/domain/upstream/secret-crypto.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('upstream key service', () => {
  let testDb: TestDb;
  let service: UpstreamKeyService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new UpstreamKeyService(testDb.db, 'test-secret-key');
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('creates upstream key with encrypted secret', async () => {
    const key = await service.createUpstreamKey({
      name: 'OpenAI Test',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-proj-secret-123',
    });
    expect(key.apiKeyCiphertext).not.toBe('sk-proj-secret-123');
    expect(key.apiKeyPrefix).toBe('sk-p');

    const decrypted = await service.decryptApiKey(key);
    expect(decrypted).toBe('sk-proj-secret-123');
  });

  it('updates api key and re-encrypts', async () => {
    const key = await service.createUpstreamKey({
      name: 'OpenAI Test',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-old',
    });
    const updated = await service.updateUpstreamKey(key.id, { apiKey: 'sk-new' });
    expect(updated!.apiKeyCiphertext).not.toBe(key.apiKeyCiphertext);
    expect(await service.decryptApiKey(updated!)).toBe('sk-new');
  });

  it('creates upstream key with quota in the same transaction', async () => {
    const key = await service.createUpstreamKey({
      name: 'OpenAI Quota',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-quota',
      quota: { period: 'day', requestLimit: 100, enabled: true },
    });

    const quota = await new UpstreamKeyRepository(testDb.db).findQuotaByUpstreamKey(key.id);
    expect(quota).toBeDefined();
    expect(quota!.period).toBe('day');
    expect(quota!.requestLimit).toBe(100);
  });

  it('encrypts auth config JSON at rest', async () => {
    const authConfig = JSON.stringify({ clientId: 'client-123', clientSecret: 'super-secret' });
    const key = await service.createUpstreamKey({
      name: 'OAuth Test',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-auth',
      authConfigJson: authConfig,
    });

    expect(key.authConfigCiphertext).not.toBe(authConfig);
    const decrypted = decryptSecret(key.authConfigCiphertext!, 'test-secret-key');
    expect(decrypted).toBe(authConfig);
  });
});
