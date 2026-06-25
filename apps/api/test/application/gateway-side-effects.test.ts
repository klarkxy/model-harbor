import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { GatewaySideEffectsService } from '../../src/application/gateway-side-effects.service.js';
import { AppRepository } from '../../src/infrastructure/db/repositories/app.repository.js';
import { ConsumerKeyRepository } from '../../src/infrastructure/db/repositories/consumer-key.repository.js';
import { UpstreamKeyRepository } from '../../src/infrastructure/db/repositories/upstream-key.repository.js';
import { SettingsRepository } from '../../src/infrastructure/db/repositories/settings.repository.js';
import { CostLedgerRepository } from '../../src/infrastructure/db/repositories/cost-ledger.repository.js';
import { usageRecords, debugContentLogs } from '../../src/infrastructure/db/schema.js';
import { eq } from 'drizzle-orm';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('gateway side-effects', () => {
  let testDb: TestDb;
  let service: GatewaySideEffectsService;
  let appId: string;
  let consumerKeyId: string;
  let upstream: NonNullable<Awaited<ReturnType<UpstreamKeyRepository['findById']>>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new GatewaySideEffectsService(testDb.db);

    const app = await new AppRepository(testDb.db).createApp({ name: 'Cost App', enabled: true });
    appId = app.id;
    const consumerKey = await new ConsumerKeyRepository(testDb.db).createConsumerKey({
      appId,
      name: 'cost-key',
      keyHash: 'cost-hash',
      keyPrefix: 'ck_',
      enabled: true,
    });
    consumerKeyId = consumerKey.id;
    const createdUpstream = await new UpstreamKeyRepository(testDb.db).createUpstreamKey({
      name: 'Cost Provider',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.example.com',
      authType: 'pat',
      apiKeyCiphertext: 'enc',
      apiKeyPrefix: 'sk-',
    });
    upstream = (await new UpstreamKeyRepository(testDb.db).findById(createdUpstream.id))!;
    await new SettingsRepository(testDb.db).seedDefaultSettings();
  });

  afterEach(async () => {
    await testDb.close();
  });

  async function recordCost(inputTokens: number, outputTokens: number): Promise<void> {
    const settings = (await new SettingsRepository(testDb.db).getSettings())!;
    await service.recordOutcome(
      {
        requestTraceId: 'cost_trace_1',
        appId,
        consumerKeyId,
        requestedTargetName: 'gpt-4o',
        resolvedTargetType: 'public_model',
        resolvedTargetId: 'pm_1',
      },
      {
        upstreamKey: upstream,
        realModelName: 'gpt-4o-prod',
        endpointUrl: 'https://api.example.com/v1/chat/completions',
        priority: 1,
        weight: 1,
        providerType: upstream.providerType,
      },
      {
        requestTraceId: 'cost_trace_1',
        appId,
        consumerKeyId,
        requestedTargetName: 'gpt-4o',
        resolvedTargetType: 'public_model',
        resolvedTargetId: 'pm_1',
        upstreamKeyId: upstream.id,
        realModelName: 'gpt-4o-prod',
        sourceProtocol: 'openai',
        providerType: upstream.providerType,
        stream: false,
        stickyHit: false,
        sessionStickyHit: false,
        conversationFingerprint: 'fp',
        latencyMs: 100,
        success: true,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      },
      settings,
    );
  }

  it('records zero cost when no pricing entry exists', async () => {
    await recordCost(10, 5);
    const rows = await testDb.db.select().from(usageRecords).where(eq(usageRecords.requestTraceId, 'cost_trace_1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.costAmount).toBe(0);
    expect(rows[0]!.costCurrency).toBe('USD');
  });

  it('records cost using generic pricing', async () => {
    await new CostLedgerRepository(testDb.db).createPricingEntry({
      providerType: 'openai_compatible',
      upstreamKeyId: null,
      realModelName: 'gpt-4o-prod',
      inputPricePer1k: 5,
      outputPricePer1k: 15,
      currency: 'USD',
      effectiveFrom: new Date(Date.now() - 60_000),
    });
    await recordCost(1000, 500);
    const rows = await testDb.db.select().from(usageRecords).where(eq(usageRecords.requestTraceId, 'cost_trace_1'));
    expect(rows[0]!.costAmount).toBe(Math.round((5 * 1000 + 15 * 500) / 1000)); // 13
    expect(rows[0]!.costCurrency).toBe('USD');
  });

  it('prefers upstream-specific pricing over generic pricing', async () => {
    await new CostLedgerRepository(testDb.db).createPricingEntry({
      providerType: 'openai_compatible',
      upstreamKeyId: null,
      realModelName: 'gpt-4o-prod',
      inputPricePer1k: 5,
      outputPricePer1k: 15,
      currency: 'USD',
      effectiveFrom: new Date(Date.now() - 60_000),
    });
    await new CostLedgerRepository(testDb.db).createPricingEntry({
      providerType: 'openai_compatible',
      upstreamKeyId: upstream.id,
      realModelName: 'gpt-4o-prod',
      inputPricePer1k: 1,
      outputPricePer1k: 2,
      currency: 'CNY',
      effectiveFrom: new Date(Date.now() - 60_000),
    });
    await recordCost(1000, 1000);
    const rows = await testDb.db.select().from(usageRecords).where(eq(usageRecords.requestTraceId, 'cost_trace_1'));
    expect(rows[0]!.costAmount).toBe(Math.round((1 * 1000 + 2 * 1000) / 1000)); // 3
    expect(rows[0]!.costCurrency).toBe('CNY');
  });
});


describe('gateway side-effects debug content', () => {
  let testDb: TestDb;
  let service: GatewaySideEffectsService;
  let appId: string;
  let consumerKeyId: string;
  let settings: Awaited<ReturnType<SettingsRepository['getSettings']>>;
  const base = {
    requestTraceId: 'debug_trace_1',
    appId: '',
    consumerKeyId: '',
    requestedTargetName: 'gpt-4o',
    resolvedTargetType: 'public_model' as const,
    resolvedTargetId: 'pm_1',
  };

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new GatewaySideEffectsService(testDb.db);

    const app = await new AppRepository(testDb.db).createApp({ name: 'Debug App', enabled: true });
    appId = app.id;
    const consumerKey = await new ConsumerKeyRepository(testDb.db).createConsumerKey({
      appId,
      name: 'debug-key',
      keyHash: 'debug-hash',
      keyPrefix: 'ck_',
      enabled: true,
    });
    consumerKeyId = consumerKey.id;
    await new SettingsRepository(testDb.db).seedDefaultSettings();
    settings = (await new SettingsRepository(testDb.db).getSettings())!;
    base.appId = appId;
    base.consumerKeyId = consumerKeyId;
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('writes debug content when enabled', async () => {
    settings.contentLogEnabled = true;
    settings.contentLogExpiresAt = new Date(Date.now() + 60_000);
    await service.recordDebugContent(
      base,
      settings,
      [{ role: 'user', content: 'hello' }],
      { choices: [{ message: { content: 'hi' } }] },
      { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    );
    const rows = await testDb.db
      .select()
      .from(debugContentLogs)
      .where(eq(debugContentLogs.requestTraceId, base.requestTraceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.inputTokens).toBe(1);
    expect(rows[0]!.outputTokens).toBe(2);
  });

  it('does not write when disabled', async () => {
    settings.contentLogEnabled = false;
    await service.recordDebugContent(
      base,
      settings,
      [{ role: 'user', content: 'hello' }],
      { content: 'hi' },
      null,
    );
    const rows = await testDb.db
      .select()
      .from(debugContentLogs)
      .where(eq(debugContentLogs.requestTraceId, base.requestTraceId));
    expect(rows).toHaveLength(0);
  });

  it('does not write when expired', async () => {
    settings.contentLogEnabled = true;
    settings.contentLogExpiresAt = new Date(Date.now() - 1);
    await service.recordDebugContent(
      base,
      settings,
      [{ role: 'user', content: 'hello' }],
      { content: 'hi' },
      null,
    );
    const rows = await testDb.db
      .select()
      .from(debugContentLogs)
      .where(eq(debugContentLogs.requestTraceId, base.requestTraceId));
    expect(rows).toHaveLength(0);
  });

  it('redacts secrets in debug content', async () => {
    settings.contentLogEnabled = true;
    settings.contentLogExpiresAt = new Date(Date.now() + 60_000);
    await service.recordDebugContent(
      base,
      settings,
      [{ role: 'user', content: 'key: sk-secret123' }],
      { headers: { Authorization: 'Bearer token' } },
      null,
    );
    const rows = await testDb.db
      .select()
      .from(debugContentLogs)
      .where(eq(debugContentLogs.requestTraceId, base.requestTraceId));
    const prompt = JSON.stringify(rows[0]!.promptJson);
    const response = JSON.stringify(rows[0]!.responseJson);
    expect(prompt).not.toContain('sk-secret123');
    expect(response).not.toContain('Bearer token');
    expect(prompt).toContain('[REDACTED]');
    expect(response).toContain('[REDACTED]');
  });

  it('evicts oldest rows when maxRows reached', async () => {
    settings.contentLogEnabled = true;
    settings.contentLogExpiresAt = new Date(Date.now() + 60_000);
    settings.contentLogMaxRows = 2;

    const firstTraceId = 'debug_trace_first';
    const secondTraceId = 'debug_trace_second';
    const thirdTraceId = 'debug_trace_third';

    await service.recordDebugContent(
      { ...base, requestTraceId: firstTraceId },
      settings,
      [{ role: 'user', content: 'first' }],
      { content: '1' },
      null,
    );
    await service.recordDebugContent(
      { ...base, requestTraceId: secondTraceId },
      settings,
      [{ role: 'user', content: 'second' }],
      { content: '2' },
      null,
    );
    await service.recordDebugContent(
      { ...base, requestTraceId: thirdTraceId },
      settings,
      [{ role: 'user', content: 'third' }],
      { content: '3' },
      null,
    );

    const all = await testDb.db.select().from(debugContentLogs);
    expect(all).toHaveLength(2);
    const traceIds = all.map((r) => r.requestTraceId).sort();
    expect(traceIds).toEqual([secondTraceId, thirdTraceId].sort());
  });
});
