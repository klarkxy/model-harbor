import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ObservabilityRepository } from '../../src/infrastructure/db/repositories/observability.repository.js';
import { ClientRepository } from '../../src/infrastructure/db/repositories/client.repository.js';
import { ProviderAccountRepository } from '../../src/infrastructure/db/repositories/provider-account.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('observability repository', () => {
  let testDb: TestDb;
  let repo: ObservabilityRepository;
  let clientId: string;
  let clientKeyId: string;
  let providerAccountId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new ObservabilityRepository(testDb.db);
    const client = await new ClientRepository(testDb.db).createClient({
      name: 'Test App',
      enabled: true,
    });
    clientId = client.id;
    const clientKey = await new ClientRepository(testDb.db).createClientKey({
      clientId: clientId,
      name: 'key',
      keyHash: 'hash',
      keyPrefix: 'ck_',
      enabled: true,
    });
    clientKeyId = clientKey.id;
    const upstream = await new ProviderAccountRepository(testDb.db).createProviderAccount({
      name: 'Provider',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com',
      authType: 'pat',
      apiKeyCiphertext: 'enc',
      apiKeyPrefix: 'sk-',
    });
    providerAccountId = upstream.id;
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('inserts usage, trace and audit records', async () => {
    const usage = await repo.insertUsageRecord({
      clientId: clientId,
      clientKeyId: clientKeyId,
      requestedTargetName: 'gpt-5',
      resolvedTargetType: 'model',
      resolvedTargetId: 'pm_1',
      providerAccountId,
      realModelName: 'gpt-5-prod',
      sourceProtocol: 'openai',
      providerType: 'openai_compatible',
      status: 'success',
      latencyMs: 120,
    });
    expect(usage.id).toBeDefined();

    const trace = await repo.insertTraceLog({
      requestTraceId: 'trace_1',
      step: 'resolve',
      stepIndex: 0,
      clientId: clientId,
    });
    expect(trace.requestTraceId).toBe('trace_1');

    const audit = await repo.insertAuditEvent({
      action: 'create',
      resourceType: 'provider_account',
      actorUsername: 'admin',
    });
    expect(audit.action).toBe('create');
  });

  it('upserts daily consumption stats', async () => {
    await repo.upsertDailyStat({
      providerAccountId,
      realModelName: 'm1',
      dayDate: '2025-01-01',
      requestCount: 1,
      successCount: 1,
      errorCount: 0,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      avgLatencyMs: 100,
      totalCostAmount: 2,
      costCurrency: 'USD',
    });
    await repo.upsertDailyStat({
      providerAccountId,
      realModelName: 'm1',
      dayDate: '2025-01-01',
      requestCount: 2,
      successCount: 2,
      errorCount: 0,
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      avgLatencyMs: 200,
      totalCostAmount: 5,
      costCurrency: 'USD',
    });
    const stat = await repo.findDailyStat(providerAccountId, 'm1', '2025-01-01');
    expect(stat!.requestCount).toBe(3);
    expect(stat!.totalCostAmount).toBe(7);
  });

  it('aggregates usage records for dashboard', async () => {
    const since = new Date(Date.now() - 60_000);
    await repo.insertUsageRecord({
      clientId: clientId,
      clientKeyId: clientKeyId,
      requestedTargetName: 'gpt-5',
      resolvedTargetType: 'model',
      resolvedTargetId: 'pm_1',
      providerAccountId,
      realModelName: 'gpt-5-prod',
      sourceProtocol: 'openai',
      providerType: 'openai_compatible',
      status: 'success',
      latencyMs: 100,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      stickyHit: true,
    });
    await repo.insertUsageRecord({
      clientId: clientId,
      clientKeyId: clientKeyId,
      requestedTargetName: 'gpt-5',
      resolvedTargetType: 'model',
      resolvedTargetId: 'pm_1',
      providerAccountId,
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

    const summary = await repo.getUsageSummary(since);
    expect(summary.requestCount).toBe(2);
    expect(summary.successCount).toBe(1);
    expect(summary.errorCount).toBe(1);
    expect(summary.inputTokens).toBe(12);
    expect(summary.totalTokens).toBe(17);
    expect(summary.stickyHitCount).toBe(1);

    const byUpstream = await repo.getUsageGroupByProviderAccount(since);
    expect(byUpstream).toHaveLength(1);
    expect(byUpstream[0]!.requestCount).toBe(2);

    const byTarget = await repo.getUsageGroupByTarget(since);
    expect(byTarget[0]!.name).toBe('gpt-5');
  });

  it('lists traces with attempt counts', async () => {
    const traceId = 'trace_success';
    await repo.insertUsageRecord({
      clientId: clientId,
      clientKeyId: clientKeyId,
      requestedTargetName: 'gpt-5',
      resolvedTargetType: 'model',
      resolvedTargetId: 'pm_1',
      requestTraceId: traceId,
      providerAccountId,
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
      providerAccountId,
      realModelName: 'gpt-5-prod',
      status: 'fail',
      errorCode: 'provider_rate_limit',
    });

    const since = new Date(Date.now() - 60_000);
    const traces = await repo.listTraces(since, 100);
    expect(traces).toHaveLength(1);
    expect(traces[0]!.requestTraceId).toBe(traceId);
    expect(traces[0]!.failedCount).toBe(1);
    expect(traces[0]!.status).toBe('success');

    const found = await repo.findTraceUsageRecord(traceId);
    expect(found).toBeDefined();
    expect(found!.requestTraceId).toBe(traceId);
  });

  it('counts failed attempts for error traces', async () => {
    const traceId = 'trace_error';
    await repo.insertUsageRecord({
      clientId: clientId,
      clientKeyId: clientKeyId,
      requestedTargetName: 'gpt-5',
      resolvedTargetType: 'model',
      resolvedTargetId: 'pm_1',
      requestTraceId: traceId,
      providerAccountId,
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
      step: 'upstream_attempt_failed',
      stepIndex: 1000,
      providerAccountId,
      realModelName: 'gpt-5-prod',
      status: 'fail',
      errorCode: 'provider_error',
    });
    await repo.insertTraceLog({
      requestTraceId: traceId,
      step: 'upstream_attempt_failed',
      stepIndex: 1001,
      providerAccountId,
      realModelName: 'gpt-5-prod',
      status: 'fail',
      errorCode: 'provider_error',
    });

    const since = new Date(Date.now() - 60_000);
    const traces = await repo.listTraces(since, 100);
    const trace = traces.find((t) => t.requestTraceId === traceId);
    expect(trace).toBeDefined();
    expect(trace!.failedCount).toBe(2);
  });
});
