import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { GatewaySideEffectsService } from '../../src/application/gateway-side-effects.service.js';
import { ClientRepository } from '../../src/infrastructure/db/repositories/client.repository.js';
import { ProviderAccountRepository } from '../../src/infrastructure/db/repositories/provider-account.repository.js';
import { SettingsRepository } from '../../src/infrastructure/db/repositories/settings.repository.js';
import { CostLedgerRepository } from '../../src/infrastructure/db/repositories/cost-ledger.repository.js';
import { usageRecords, debugContentLogs } from '../../src/infrastructure/db/schema.js';
import { eq } from 'drizzle-orm';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';
import { createTestProviderAccountWithEndpoint } from '../helpers/account.js';
import type { EndpointRow } from '../../src/infrastructure/db/schema.js';

describe('gateway side-effects', () => {
  let testDb: TestDb;
  let service: GatewaySideEffectsService;
  let clientId: string;
  let clientKeyId: string;
  let endpoint: EndpointRow;
  let account: NonNullable<Awaited<ReturnType<ProviderAccountRepository['findById']>>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new GatewaySideEffectsService(testDb.db);

    const client = await new ClientRepository(testDb.db).createClient({
      name: 'Cost App',
      enabled: true,
    });
    clientId = client.id;
    const clientKey = await new ClientRepository(testDb.db).createClientKey({
      clientId: clientId,
      name: 'cost-key',
      keyHash: 'cost-hash',
      keyPrefix: 'ck_',
      enabled: true,
    });
    clientKeyId = clientKey.id;
    // v1 candidate 严格绑定 endpoint：recordOutcome 通过 usage_records.endpoint_id
    // 写 FK 引用，故测试需要拿真实 endpoint.id，不能用字符串占位。
    const created = await createTestProviderAccountWithEndpoint(testDb.db, {
      name: 'Cost Provider',
      providerType: 'openai_compatible',
    });
    account = created.account;
    endpoint = created.endpoint;
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
        clientId: clientId,
        clientKeyId: clientKeyId,
        requestedTargetName: 'gpt-4o',
        resolvedTargetType: 'model',
        resolvedTargetId: 'pm_1',
      },
      {
        providerAccount: account,
        realModelName: 'gpt-4o-prod',
        endpointUrl: 'https://api.example.com/v1/chat/completions',
        priority: 1,
        weight: 1,
        providerType: account.providerType,
        endpointProtocol: 'openai',
        protocolConversion: 'native',
        endpoint: {
          id: endpoint.id,
          providerAccountId: account.id,
          protocol: endpoint.protocol as 'openai' | 'anthropic' | 'codex',
          baseUrl: endpoint.baseUrl,
          path: endpoint.path,
          providerType: account.providerType,
          capabilities: [],
          enabled: true,
          displayOrder: 1000,
        },
      },
      {
        requestTraceId: 'cost_trace_1',
        clientId: clientId,
        clientKeyId: clientKeyId,
        requestedTargetName: 'gpt-4o',
        resolvedTargetType: 'model',
        resolvedTargetId: 'pm_1',
        providerAccountId: account.id,
        realModelName: 'gpt-4o-prod',
        sourceProtocol: 'openai',
        providerType: account.providerType,
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
    const rows = await testDb.db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.requestTraceId, 'cost_trace_1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.costAmount).toBe(0);
    expect(rows[0]!.costCurrency).toBe('USD');
  });

  it('records cost using generic pricing', async () => {
    await new CostLedgerRepository(testDb.db).createPricingEntry({
      providerType: 'openai_compatible',
      providerAccountId: null,
      realModelName: 'gpt-4o-prod',
      inputPricePer1k: 5,
      outputPricePer1k: 15,
      currency: 'USD',
      effectiveFrom: new Date(Date.now() - 60_000),
    });
    await recordCost(1000, 500);
    const rows = await testDb.db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.requestTraceId, 'cost_trace_1'));
    expect(rows[0]!.costAmount).toBe(Math.round((5 * 1000 + 15 * 500) / 1000)); // 13
    expect(rows[0]!.costCurrency).toBe('USD');
  });

  it('prefers upstream-specific pricing over generic pricing', async () => {
    await new CostLedgerRepository(testDb.db).createPricingEntry({
      providerType: 'openai_compatible',
      providerAccountId: null,
      realModelName: 'gpt-4o-prod',
      inputPricePer1k: 5,
      outputPricePer1k: 15,
      currency: 'USD',
      effectiveFrom: new Date(Date.now() - 60_000),
    });
    await new CostLedgerRepository(testDb.db).createPricingEntry({
      providerType: 'openai_compatible',
      providerAccountId: account.id,
      realModelName: 'gpt-4o-prod',
      inputPricePer1k: 1,
      outputPricePer1k: 2,
      currency: 'CNY',
      effectiveFrom: new Date(Date.now() - 60_000),
    });
    await recordCost(1000, 1000);
    const rows = await testDb.db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.requestTraceId, 'cost_trace_1'));
    expect(rows[0]!.costAmount).toBe(Math.round((1 * 1000 + 2 * 1000) / 1000)); // 3
    expect(rows[0]!.costCurrency).toBe('CNY');
  });
});

describe('gateway side-effects debug content', () => {
  let testDb: TestDb;
  let service: GatewaySideEffectsService;
  let clientId: string;
  let clientKeyId: string;
  let settings: Awaited<ReturnType<SettingsRepository['getSettings']>>;
  const base = {
    requestTraceId: 'debug_trace_1',
    clientId: '',
    clientKeyId: '',
    requestedTargetName: 'gpt-4o',
    resolvedTargetType: 'model' as const,
    resolvedTargetId: 'pm_1',
  };

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new GatewaySideEffectsService(testDb.db);

    const client = await new ClientRepository(testDb.db).createClient({
      name: 'Debug App',
      enabled: true,
    });
    clientId = client.id;
    const clientKey = await new ClientRepository(testDb.db).createClientKey({
      clientId: clientId,
      name: 'debug-key',
      keyHash: 'debug-hash',
      keyPrefix: 'ck_',
      enabled: true,
    });
    clientKeyId = clientKey.id;
    await new SettingsRepository(testDb.db).seedDefaultSettings();
    settings = (await new SettingsRepository(testDb.db).getSettings())!;
    base.clientId = clientId;
    base.clientKeyId = clientKeyId;
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
