import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { TraceService } from '../../src/application/trace.service.js';
import { AppRepository } from '../../src/infrastructure/db/repositories/app.repository.js';
import { ConsumerKeyRepository } from '../../src/infrastructure/db/repositories/consumer-key.repository.js';
import { UpstreamKeyRepository } from '../../src/infrastructure/db/repositories/upstream-key.repository.js';
import { ObservabilityRepository } from '../../src/infrastructure/db/repositories/observability.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('trace service', () => {
  let testDb: TestDb;
  let service: TraceService;
  let repo: ObservabilityRepository;
  let appId: string;
  let consumerKeyId: string;
  let upstreamKeyId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new TraceService(testDb.db);
    repo = new ObservabilityRepository(testDb.db);
    const app = await new AppRepository(testDb.db).createApp({ name: 'Test App', enabled: true });
    appId = app.id;
    const consumerKey = await new ConsumerKeyRepository(testDb.db).createConsumerKey({
      appId,
      name: 'key',
      keyHash: 'hash',
      keyPrefix: 'ck_',
      enabled: true,
    });
    consumerKeyId = consumerKey.id;
    const upstream = await new UpstreamKeyRepository(testDb.db).createUpstreamKey({
      name: 'Provider',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com',
      authType: 'pat',
      apiKeyCiphertext: 'enc',
      apiKeyPrefix: 'sk-',
    });
    upstreamKeyId = upstream.id;
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('lists traces and computes attempt count', async () => {
    const traceId = 'trace_1';
    await repo.insertUsageRecord({
      appId,
      consumerKeyId,
      requestedTargetName: 'gpt-5',
      resolvedTargetType: 'public_model',
      resolvedTargetId: 'pm_1',
      requestTraceId: traceId,
      upstreamKeyId,
      realModelName: 'gpt-5-prod',
      sourceProtocol: 'openai',
      providerType: 'openai_compatible',
      status: 'success',
      latencyMs: 100,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      stickyHit: false,
    });
    await repo.insertTraceLog({
      requestTraceId: traceId,
      step: 'upstream_attempt_failed',
      stepIndex: 1000,
      upstreamKeyId,
      realModelName: 'gpt-5-prod',
      status: 'fail',
      errorCode: 'provider_rate_limit',
    });

    const since = new Date(Date.now() - 60_000);
    const traces = await service.listTraces(since, 100);
    expect(traces).toHaveLength(1);
    expect(traces[0]!.attemptCount).toBe(2);
  });

  it('returns trace detail with summary and events', async () => {
    const traceId = 'trace_2';
    await repo.insertUsageRecord({
      appId,
      consumerKeyId,
      requestedTargetName: 'gpt-5',
      resolvedTargetType: 'public_model',
      resolvedTargetId: 'pm_1',
      requestTraceId: traceId,
      upstreamKeyId,
      realModelName: 'gpt-5-prod',
      sourceProtocol: 'openai',
      providerType: 'openai_compatible',
      status: 'provider_error',
      latencyMs: 200,
      inputTokens: 2,
      outputTokens: 0,
      totalTokens: 2,
      stickyHit: false,
    });
    await repo.insertTraceLog({
      requestTraceId: traceId,
      step: 'routing_decision',
      stepIndex: 10,
      status: 'ok',
      details: { candidateCount: 1 },
    });

    const detail = await service.getTraceDetail(traceId);
    expect(detail.summary).toBeDefined();
    expect(detail.summary!.status).toBe('provider_error');
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]!.step).toBe('routing_decision');
  });
});
