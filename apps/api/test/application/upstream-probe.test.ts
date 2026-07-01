import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ProviderAccountService } from '../../src/application/provider-account.service.js';
import { EndpointRepository } from '../../src/infrastructure/db/repositories/endpoint.repository.js';
import { ProbeService } from '../../src/application/probe.service.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';
import type { UpstreamSender, UpstreamResponse } from '../../src/gateway/upstream-sender.js';

function makeSender(
  response: Omit<UpstreamResponse, 'latencyMs'> & { latencyMs?: number },
): UpstreamSender {
  return {
    send: async () => ({ latencyMs: 0, ...response }) as UpstreamResponse,
  } as UpstreamSender;
}

function makeCapturingSender(
  response: Omit<UpstreamResponse, 'latencyMs'> & { latencyMs?: number },
): { sender: UpstreamSender; urls: string[] } {
  const urls: string[] = [];
  const sender = {
    send: async (req: { url: string }) => {
      urls.push(req.url);
      return { latencyMs: 0, ...response } as UpstreamResponse;
    },
  } as UpstreamSender;
  return { sender, urls };
}

describe('probe service', () => {
  let testDb: TestDb;
  let service: ProviderAccountService;
  let endpointRepo: EndpointRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new ProviderAccountService(testDb.db, 'test-secret-key');
    endpointRepo = new EndpointRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('discovers models from upstream /v1/models', async () => {
    const account = await service.createProviderAccount({
      name: 'Probe',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-probe',
    });

    const endpoints = await endpointRepo.listByProviderAccount(account.id);
    expect(endpoints.length).toBeGreaterThan(0);

    const probe = new ProbeService({
      db: testDb.db,
      secretKey: 'test-secret-key',
      sender: makeSender({
        status: 200,
        headers: {},
        body: {
          data: [
            { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
            { id: 'gpt-4', object: 'model' },
          ],
        },
      }),
    });

    const models = await probe.discoverModels({ endpointId: endpoints[0]!.id });
    expect(models).toEqual([
      { id: 'gpt-4o', object: 'model', ownedBy: 'openai' },
      { id: 'gpt-4', object: 'model' },
    ]);
  });

  it('throws when discover upstream returns non-2xx', async () => {
    const account = await service.createProviderAccount({
      name: 'Probe',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-probe',
    });

    const endpoints = await endpointRepo.listByProviderAccount(account.id);

    const probe = new ProbeService({
      db: testDb.db,
      secretKey: 'test-secret-key',
      sender: makeSender({ status: 401, headers: {}, body: { error: 'Unauthorized' } }),
    });

    await expect(probe.discoverModels({ endpointId: endpoints[0]!.id })).rejects.toThrow(
      '上游返回 401',
    );
  });

  it('pings upstream chat completions', async () => {
    const account = await service.createProviderAccount({
      name: 'Probe',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-probe',
      supportedModels: ['gpt-3.5-turbo'],
    });

    const endpoints = await endpointRepo.listByProviderAccount(account.id);

    const probe = new ProbeService({
      db: testDb.db,
      secretKey: 'test-secret-key',
      sender: makeSender({ status: 200, headers: {}, body: { id: 'chatcmpl-1' } }),
    });

    const result = await probe.ping({ endpointId: endpoints[0]!.id });
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeNull();
  });

  it('returns error details when ping upstream returns non-2xx', async () => {
    const account = await service.createProviderAccount({
      name: 'Probe',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-probe',
      supportedModels: ['gpt-3.5-turbo'],
    });

    const endpoints = await endpointRepo.listByProviderAccount(account.id);

    const probe = new ProbeService({
      db: testDb.db,
      secretKey: 'test-secret-key',
      sender: makeSender({
        status: 400,
        headers: {},
        body: { error: { message: 'invalid model' } },
      }),
    });

    const result = await probe.ping({ endpointId: endpoints[0]!.id });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid model');
  });

  it('pings a specific endpoint by endpointId', async () => {
    const account = await service.createProviderAccount({
      name: 'Moonshot Probe',
      providerPresetId: 'moonshot',
      providerType: 'moonshot',
      baseUrl: 'https://api.moonshot.ai/anthropic',
      apiKey: 'sk-moonshot',
      endpoints: [
        {
          protocol: 'anthropic',
          baseUrl: 'https://api.moonshot.ai/anthropic',
          providerType: 'anthropic_compatible',
        },
        {
          protocol: 'openai',
          baseUrl: 'https://api.moonshot.ai',
          providerType: 'openai_compatible',
        },
      ],
    });

    const endpoints = await endpointRepo.listByProviderAccount(account.id);
    const openaiEndpoint = endpoints.find((e) => e.protocol === 'openai');
    expect(openaiEndpoint).toBeDefined();

    const { sender, urls } = makeCapturingSender({
      status: 200,
      headers: {},
      body: { id: 'chatcmpl-1' },
    });

    const probe = new ProbeService({
      db: testDb.db,
      secretKey: 'test-secret-key',
      sender,
    });

    const result = await probe.ping({ endpointId: openaiEndpoint!.id });
    expect(result.ok).toBe(true);
    expect(urls).toEqual(['https://api.moonshot.ai/v1/chat/completions']);
  });

  it('discovers models using the OpenAI-compatible endpoint when available', async () => {
    const account = await service.createProviderAccount({
      name: 'Moonshot Discover',
      providerPresetId: 'moonshot',
      providerType: 'moonshot',
      baseUrl: 'https://api.moonshot.ai/anthropic',
      apiKey: 'sk-moonshot',
      endpoints: [
        {
          protocol: 'anthropic',
          baseUrl: 'https://api.moonshot.ai/anthropic',
          providerType: 'anthropic_compatible',
        },
        {
          protocol: 'openai',
          baseUrl: 'https://api.moonshot.ai',
          providerType: 'openai_compatible',
        },
      ],
    });

    const endpoints = await endpointRepo.listByProviderAccount(account.id);
    // discoverModels picks the OpenAI-compatible endpoint by default
    const openaiEndpoint = endpoints.find(
      (e) => e.providerType === 'openai_compatible' || e.protocol === 'openai',
    );
    expect(openaiEndpoint).toBeDefined();

    const { sender, urls } = makeCapturingSender({
      status: 200,
      headers: {},
      body: { data: [{ id: 'kimi-k2', object: 'model' }] },
    });

    const probe = new ProbeService({
      db: testDb.db,
      secretKey: 'test-secret-key',
      sender,
    });

    const models = await probe.discoverModels({ endpointId: openaiEndpoint!.id });
    expect(models).toEqual([{ id: 'kimi-k2', object: 'model' }]);
    expect(urls).toEqual(['https://api.moonshot.ai/v1/models']);
  });
});
