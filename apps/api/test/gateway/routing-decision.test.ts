import { describe, it, expect } from 'vitest';
import { RoutingDecisionService } from '../../src/application/routing-decision.service.js';
import type {
  RoutingDecisionInput,
  RoutingSettingsSnapshot,
} from '../../src/application/routing.types.js';
import type { ModelRepository } from '../../src/infrastructure/db/repositories/model.repository.js';
import type { ChannelRepository } from '../../src/infrastructure/db/repositories/channel.repository.js';
import type { ProviderAccountRepository } from '../../src/infrastructure/db/repositories/provider-account.repository.js';
import type { RoutingStateRepository } from '../../src/infrastructure/db/repositories/routing-state.repository.js';
import type { EndpointRepository } from '../../src/infrastructure/db/repositories/endpoint.repository.js';
import {
  type ProviderAccountRow,
  type EndpointRow,
  type ModelCandidateRow,
  type ChannelMemberRow,
} from '../../src/infrastructure/db/schema.js';
import { protocolFor } from '@manageyourllm/shared';

const defaultSettings: RoutingSettingsSnapshot = {
  enableStickySession: true,
  enableCircuitBreaker: true,
  publicBaseUrl: 'http://localhost',
  circuitBreakerBaseCooldownMs: 60000,
  circuitBreakerMaxCooldownMs: 600000,
  circuitBreakerHalfOpenSuccessCount: 2,
  stickySessionTtlMs: 300000,
  firstTokenTimeoutMs: 15000,
  defaultRequestTimeoutMs: 30000,
  defaultRetries: 0,
};

function makeProviderAccount(
  id: string,
  overrides: Partial<ProviderAccountRow> = {},
): ProviderAccountRow {
  const now = new Date();
  return {
    id,
    name: id,
    providerPresetId: null,
    providerType: 'openai_compatible',
    baseUrl: 'https://example.com',
    authType: 'pat',
    apiKeyCiphertext: 'cipher',
    apiKeyPrefix: 'sk',
    authConfigCiphertext: null,
    defaultHeadersJson: null,
    extraHeadersJson: null,
    extraParamsJson: null,
    supportedModelsJson: [],
    displayOrder: 1000,
    enabled: true,
    frozen: false,
    frozenReason: null,
    lastUsedAt: null,
    stickySessionTtlMs: 300000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEndpoint(
  id: string,
  accountId: string,
  overrides: Partial<EndpointRow> = {},
): EndpointRow {
  const now = new Date();
  return {
    id,
    providerAccountId: accountId,
    protocol: 'openai',
    baseUrl: 'https://example.com',
    path: null,
    providerType: 'openai_compatible',
    defaultHeadersJson: null,
    extraHeadersJson: null,
    extraParamsJson: null,
    capabilitiesJson: [],
    enabled: true,
    displayOrder: 1000,
    isPresetDefault: false,
    source: 'user',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * v1 candidate 必须绑定 endpointId。fixture helper：1 provider + 1 endpoint + 1 candidate。
 * 多个 endpoint 的场景可由 caller 显式传 endpointOverrides / candidateOverrides。
 */
function makeCandidate(
  overrides: Partial<ModelCandidateRow> & {
    id?: string;
    endpointId?: string;
    modelId?: string;
  } = {},
): ModelCandidateRow {
  const now = new Date();
  const providerAccountId =
    overrides.providerAccountId ?? overrides?.['providerAccountId'] ?? 'uk1';
  const effectiveEpId = overrides.endpointId ?? `ep_${providerAccountId}`;
  return {
    id: overrides.id ?? 'pmc',
    modelId: overrides.modelId ?? 'pm',
    providerAccountId,
    endpointId: effectiveEpId,
    realModelName: 'real-model',
    enabled: true,
    priority: 100,
    pingLatencyMs: null,
    pingStatus: null,
    endpointUrl: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeInput(partial: Partial<RoutingDecisionInput> = {}): RoutingDecisionInput {
  return {
    ir: {
      sourceProtocol: 'openai',
      requestedModel: 'gpt-4o',
      system: null,
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: null,
      temperature: null,
      topP: null,
      stream: false,
      metadata: {},
      rawRequest: { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] },
    },
    resolvedTarget: { type: 'model', id: 'pm', name: 'gpt-4o', entity: undefined as never },
    clientKeyId: 'ck',
    clientId: 'app',
    settings: defaultSettings,
    now: new Date(),
    ...partial,
  };
}

function createService(mocks: {
  candidates?: ModelCandidateRow[];
  providerAccounts?: ProviderAccountRow[];
  endpoints?: EndpointRow[];
  members?: ChannelMemberRow[];
  modelEnabled?: boolean;
  channelEnabled?: boolean;
  quotas?: Record<
    string,
    {
      requestLimit?: number | null;
      requestCount?: number;
      inputTokenLimit?: number | null;
      inputTokens?: number;
      outputTokenLimit?: number | null;
      outputTokens?: number;
      totalTokenLimit?: number | null;
      totalTokens?: number;
    }
  >;
  breakers?: Record<
    string,
    { state: 'closed' | 'open' | 'half_open'; cooldownUntil: Date | null; realModelName?: string }
  >;
  stickyBinding?: {
    providerAccountId: string;
    realModelName: string;
    endpointId?: string | null;
    endpointUrl?: string | null;
  } | null;
  stickySession?: {
    providerAccountId: string;
    realModelName: string;
    endpointId?: string | null;
    endpointUrl?: string | null;
  } | null;
}) {
  const accountMap = new Map(mocks.providerAccounts?.map((u) => [u.id, u]) ?? []);
  const endpointMap = new Map(mocks.endpoints?.map((e) => [e.id, e]) ?? []);

  // 自动为每个 providerAccount 派生一个默认 endpoint（如果 caller 没显式传）。
  for (const aid of accountMap.keys()) {
    const epId = `ep_${aid}`;
    if (!endpointMap.has(epId)) {
      const account = accountMap.get(aid)!;
      const now = new Date();
      endpointMap.set(epId, {
        id: epId,
        providerAccountId: aid,
        protocol: protocolFor(account.providerType) as EndpointRow['protocol'],
        baseUrl: account.baseUrl,
        path: null,
        providerType: account.providerType,
        defaultHeadersJson: null,
        extraHeadersJson: null,
        extraParamsJson: null,
        capabilitiesJson: [],
        enabled: true,
        displayOrder: 1000,
        isPresetDefault: false,
        source: 'user',
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 自动给每个 candidate 补 endpointId = ep_{providerAccountId}，让 fixture 简洁。
  const candidates = (mocks.candidates ?? []).map((c) => ({
    ...c,
    endpointId: c.endpointId ?? `ep_${c.providerAccountId}`,
  }));

  const modelRepo = {
    listCandidates: async (modelId: string) => candidates.filter((c) => c.modelId === modelId),
    findById: async () =>
      ({
        id: 'pm',
        enabled: mocks.modelEnabled ?? true,
      }) as Awaited<ReturnType<ModelRepository['findById']>>,
  } as unknown as ModelRepository;

  const channelRepo = {
    listMembers: async () => mocks.members ?? [],
    findById: async () =>
      ({
        id: 'ch',
        enabled: mocks.channelEnabled ?? true,
      }) as Awaited<ReturnType<ChannelRepository['findById']>>,
  } as unknown as ChannelRepository;

  const providerAccountRepo = {
    findById: async (id: string) => accountMap.get(id),
    findByIds: async (ids: string[]) => {
      const result = new Map<string, ProviderAccountRow>();
      for (const id of ids) {
        const row = accountMap.get(id);
        if (row) result.set(id, row);
      }
      return result;
    },
    findQuotaByProviderAccount: async (providerAccountId: string) => {
      const q = mocks.quotas?.[providerAccountId];
      if (!q) return undefined;
      return {
        requestLimit: q.requestLimit ?? null,
        inputTokenLimit: q.inputTokenLimit ?? null,
        outputTokenLimit: q.outputTokenLimit ?? null,
        totalTokenLimit: q.totalTokenLimit ?? null,
        enabled: true,
      } as Awaited<ReturnType<ProviderAccountRepository['findQuotaByProviderAccount']>>;
    },
    findCounter: async (providerAccountId: string) => {
      const q = mocks.quotas?.[providerAccountId];
      if (!q) return undefined;
      const hasLimit =
        q.requestLimit != null ||
        q.inputTokenLimit != null ||
        q.outputTokenLimit != null ||
        q.totalTokenLimit != null;
      if (!hasLimit) return undefined;
      return {
        requestCount: q.requestCount ?? 0,
        inputTokens: q.inputTokens ?? 0,
        outputTokens: q.outputTokens ?? 0,
        totalTokens: q.totalTokens ?? 0,
        periodEndsAt: new Date(Date.now() + 60 * 60 * 1000),
      } as Awaited<ReturnType<ProviderAccountRepository['findCounter']>>;
    },
  } as unknown as ProviderAccountRepository;

  const endpointRepo = {
    findById: async (id: string) => endpointMap.get(id),
    findByIds: async (ids: string[]) => {
      const result = new Map<string, EndpointRow>();
      for (const id of ids) {
        const row = endpointMap.get(id);
        if (row) result.set(id, row);
      }
      return result;
    },
    listByProviderAccount: async (providerAccountId: string) =>
      Array.from(endpointMap.values()).filter((e) => e.providerAccountId === providerAccountId),
  } as unknown as EndpointRepository;

  const routingStateRepo = {
    findBreaker: async (providerAccountId: string, _endpointId: string, realModelName: string) => {
      const b = mocks.breakers?.[providerAccountId];
      if (!b) return undefined;
      if (b.realModelName && b.realModelName !== realModelName) return undefined;
      return { state: b.state, cooldownUntil: b.cooldownUntil } as Awaited<
        ReturnType<RoutingStateRepository['findBreaker']>
      >;
    },
    updateBreakerState: async (
      _providerAccountId: string,
      _endpointId: string,
      _realModelName: string,
      state: 'closed' | 'open' | 'half_open',
    ) => {
      const b = mocks.breakers?.[_providerAccountId];
      return {
        state,
        cooldownUntil: b?.cooldownUntil ?? null,
      } as Awaited<ReturnType<RoutingStateRepository['updateBreakerState']>>;
    },
    findStickyBinding: async () =>
      mocks.stickyBinding
        ? ({
            ...mocks.stickyBinding,
            endpointUrl: mocks.stickyBinding.endpointUrl ?? null,
          } as Awaited<ReturnType<RoutingStateRepository['findStickyBinding']>>)
        : undefined,
    findStickySession: async () =>
      mocks.stickySession
        ? ({
            ...mocks.stickySession,
            endpointUrl: mocks.stickySession.endpointUrl ?? null,
          } as Awaited<ReturnType<RoutingStateRepository['findStickySession']>>)
        : undefined,
  } as unknown as RoutingStateRepository;

  return new RoutingDecisionService(
    modelRepo,
    channelRepo,
    providerAccountRepo,
    routingStateRepo,
    endpointRepo,
  );
}

describe('RoutingDecisionService (v1 snapshot)', () => {
  it('expands model candidates and sorts by priority', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1'), makeProviderAccount('uk2')],
      candidates: [
        makeCandidate({ id: 'c2', providerAccountId: 'uk2', priority: 200 }),
        makeCandidate({ id: 'c1', providerAccountId: 'uk1', priority: 50 }),
      ],
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk1', 'uk2']);
  });

  it('drops disabled provider accounts', async () => {
    const service = createService({
      providerAccounts: [
        makeProviderAccount('uk1', { enabled: false }),
        makeProviderAccount('uk2'),
      ],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1' }),
        makeCandidate({ providerAccountId: 'uk2' }),
      ],
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2']);
    expect(decision.traceEvents.some((e) => e.step === 'filter_disabled')).toBe(true);
  });

  it('drops disabled endpoints', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1'), makeProviderAccount('uk2')],
      endpoints: [makeEndpoint('ep_uk1', 'uk1', { enabled: false })],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1' }),
        makeCandidate({ providerAccountId: 'uk2' }),
      ],
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2']);
    expect(decision.traceEvents.some((e) => e.step === 'filter_endpoint_disabled')).toBe(true);
  });

  it('drops disabled candidates', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1'), makeProviderAccount('uk2')],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1', enabled: false }),
        makeCandidate({ providerAccountId: 'uk2', enabled: true }),
      ],
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2']);
    expect(decision.traceEvents.some((e) => e.step === 'filter_candidate_disabled')).toBe(true);
  });

  it('drops frozen provider accounts', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1', { frozen: true }), makeProviderAccount('uk2')],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1' }),
        makeCandidate({ providerAccountId: 'uk2' }),
      ],
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2']);
  });

  it('drops open circuit breakers still in cooldown', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1'), makeProviderAccount('uk2')],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1' }),
        makeCandidate({ providerAccountId: 'uk2' }),
      ],
      breakers: { uk1: { state: 'open', cooldownUntil: new Date(Date.now() + 60000) } },
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2']);
  });

  it('allows open circuit breakers whose cooldown has passed', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1')],
      candidates: [makeCandidate({ providerAccountId: 'uk1' })],
      breakers: { uk1: { state: 'open', cooldownUntil: new Date(Date.now() - 1000) } },
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates).toHaveLength(1);
    expect(decision.traceEvents.some((e) => e.step === 'filter_breaker_half_open')).toBe(true);
  });

  it('drops closed circuit breakers still in cooldown', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1'), makeProviderAccount('uk2')],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1' }),
        makeCandidate({ providerAccountId: 'uk2' }),
      ],
      breakers: { uk1: { state: 'closed', cooldownUntil: new Date(Date.now() + 60000) } },
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2']);
    expect(decision.traceEvents.some((e) => e.step === 'filter_cooldown')).toBe(true);
  });

  it('drops disabled models', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1')],
      candidates: [makeCandidate({ providerAccountId: 'uk1' })],
      modelEnabled: false,
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates).toHaveLength(0);
    expect(decision.traceEvents.some((e) => e.step === 'filter_model_disabled')).toBe(true);
  });

  it('drops disabled channels', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1')],
      members: [
        {
          id: 'cm1',
          channelId: 'ch',
          modelId: 'pm',
          priority: 100,
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ChannelMemberRow,
      ],
      channelEnabled: false,
    });

    const decision = await service.decide(
      makeInput({
        resolvedTarget: { type: 'channel', id: 'ch', name: 'fast', entity: undefined as never },
      }),
    );
    expect(decision.candidates).toHaveLength(0);
    expect(decision.traceEvents.some((e) => e.step === 'filter_channel_disabled')).toBe(true);
  });

  it('keeps convertible candidates and sorts native before convertible', async () => {
    const service = createService({
      providerAccounts: [
        makeProviderAccount('uk1', { providerType: 'anthropic_compatible' }),
        makeProviderAccount('uk2', { providerType: 'openai_compatible' }),
      ],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1' }),
        makeCandidate({ providerAccountId: 'uk2' }),
      ],
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2', 'uk1']);
    expect(decision.candidates[0]!.protocolConversion).toBe('native');
    expect(decision.candidates[1]!.protocolConversion).toBe('convertible');
  });

  it('drops candidates that lack required capabilities (providerType-based)', async () => {
    const service = createService({
      providerAccounts: [
        makeProviderAccount('uk1', { providerType: 'deepseek' }),
        makeProviderAccount('uk2', { providerType: 'openai_compatible' }),
      ],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1' }),
        makeCandidate({ providerAccountId: 'uk2' }),
      ],
    });

    const input = makeInput({
      ir: {
        sourceProtocol: 'openai',
        requestedModel: 'gpt-4o',
        system: null,
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: null,
        temperature: null,
        topP: null,
        stream: false,
        metadata: {},
        rawRequest: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
        },
      },
    });

    const decision = await service.decide(input);
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2']);
  });

  it('drops candidates whose endpoint capabilities are insufficient', async () => {
    const service = createService({
      providerAccounts: [
        makeProviderAccount('uk1', { providerType: 'openai_compatible' }),
        makeProviderAccount('uk2', { providerType: 'openai_compatible' }),
      ],
      // uk1 endpoint 显式声明不支持 vision；uk2 endpoint 不约束。
      endpoints: [makeEndpoint('ep_uk1', 'uk1', { capabilitiesJson: ['chat'] })],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1' }),
        makeCandidate({ providerAccountId: 'uk2' }),
      ],
    });

    const input = makeInput({
      ir: {
        sourceProtocol: 'openai',
        requestedModel: 'gpt-4o',
        system: null,
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: null,
        temperature: null,
        topP: null,
        stream: false,
        metadata: {},
        rawRequest: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
        },
      },
    });

    const decision = await service.decide(input);
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2']);
    expect(decision.traceEvents.some((e) => e.step === 'filter_endpoint_capability')).toBe(true);
  });

  it('drops candidates whose quota is exhausted (request count)', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1'), makeProviderAccount('uk2')],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1' }),
        makeCandidate({ providerAccountId: 'uk2' }),
      ],
      quotas: { uk1: { requestLimit: 10, requestCount: 10 } },
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2']);
  });

  it('drops candidates whose input token quota is exhausted', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1'), makeProviderAccount('uk2')],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1' }),
        makeCandidate({ providerAccountId: 'uk2' }),
      ],
      quotas: { uk1: { inputTokenLimit: 1000, inputTokens: 1000 } },
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2']);
  });

  it('drops candidates whose output token quota is exhausted', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1'), makeProviderAccount('uk2')],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1' }),
        makeCandidate({ providerAccountId: 'uk2' }),
      ],
      quotas: { uk1: { outputTokenLimit: 1000, outputTokens: 1000 } },
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2']);
  });

  it('drops candidates whose total token quota is exhausted', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1'), makeProviderAccount('uk2')],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1' }),
        makeCandidate({ providerAccountId: 'uk2' }),
      ],
      quotas: { uk1: { totalTokenLimit: 1000, totalTokens: 1000 } },
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2']);
  });

  // 砍 sortCandidates 后的关键验证：
  it('does not re-sort by latency — only priority + native preference', async () => {
    // 两个 candidate priority 相同；v1 不再按 ping latency 重排。
    // trace events 不再含 candidates_sort step。
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1'), makeProviderAccount('uk2')],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1', priority: 100 }),
        makeCandidate({ providerAccountId: 'uk2', priority: 100 }),
      ],
    });

    const decision = await service.decide(makeInput());
    // priority 相同 → 走 id 字典序稳定排序，c1 < c2（uk1 优先）。
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk1', 'uk2']);
    expect(decision.traceEvents.some((e) => e.step === 'candidates_sort')).toBe(false);
  });

  it('keeps priority as primary order, even when some are convertible', async () => {
    // uk1 priority=50, anthropic（针对 openai source = convertible）
    // uk2 priority=200, openai（native）
    // v1 顺序：priority 优先 → uk1 优先，但 convertible 应被原协议优先 step 标记。
    // 注：filterCandidates 不会 drop convertible；它会经过 filter_protocol_convertible event。
    const service = createService({
      providerAccounts: [
        makeProviderAccount('uk1', { providerType: 'anthropic_compatible' }),
        makeProviderAccount('uk2', { providerType: 'openai_compatible' }),
      ],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1', priority: 50 }),
        makeCandidate({ providerAccountId: 'uk2', priority: 200 }),
      ],
    });

    const decision = await service.decide(makeInput());
    // priority 升序：uk1 (50) → uk2 (200)
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk1', 'uk2']);
    expect(decision.candidates[0]!.protocolConversion).toBe('convertible');
    expect(decision.candidates[1]!.protocolConversion).toBe('native');
  });

  it('sorts native before convertible when priority is equal', async () => {
    const service = createService({
      providerAccounts: [
        makeProviderAccount('uk1', { providerType: 'anthropic_compatible' }),
        makeProviderAccount('uk2', { providerType: 'openai_compatible' }),
      ],
      candidates: [
        makeCandidate({ providerAccountId: 'uk1', priority: 100 }),
        makeCandidate({ providerAccountId: 'uk2', priority: 100 }),
      ],
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates.map((c) => c.providerAccount.id)).toEqual(['uk2', 'uk1']);
    expect(decision.candidates[0]!.protocolConversion).toBe('native');
    expect(decision.candidates[1]!.protocolConversion).toBe('convertible');
  });

  it('moves sticky binding candidate to front (matches providerAccount+model)', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1'), makeProviderAccount('uk2')],
      candidates: [
        makeCandidate({ id: 'c_uk1', providerAccountId: 'uk1', realModelName: 'a' }),
        makeCandidate({ id: 'c_uk2', providerAccountId: 'uk2', realModelName: 'b' }),
      ],
      stickyBinding: { providerAccountId: 'uk2', realModelName: 'b' },
    });

    const decision = await service.decide(makeInput());
    expect(decision.candidates[0]!.providerAccount.id).toBe('uk2');
    expect(decision.stickyHit).toBe(true);
  });

  it('matches sticky binding by endpointId when recorded', async () => {
    // 同一 providerAccount 跨 endpoint：sticky 应只匹配 endpointId 相同的 candidate。
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1', { baseUrl: 'https://api.example.com' })],
      endpoints: [
        makeEndpoint('ep_uk1_chat', 'uk1', {
          baseUrl: 'https://api.example.com',
          path: '/chat',
        }),
        makeEndpoint('ep_uk1_anthropic', 'uk1', {
          baseUrl: 'https://api.example.com',
          path: '/anthropic',
          protocol: 'anthropic',
          providerType: 'anthropic_compatible',
        }),
      ],
      candidates: [
        makeCandidate({
          id: 'c_chat',
          providerAccountId: 'uk1',
          endpointId: 'ep_uk1_chat',
          realModelName: 'a',
        }),
        makeCandidate({
          id: 'c_anthropic',
          providerAccountId: 'uk1',
          endpointId: 'ep_uk1_anthropic',
          realModelName: 'a',
        }),
      ],
      stickyBinding: {
        providerAccountId: 'uk1',
        realModelName: 'a',
        endpointId: 'ep_uk1_chat',
      },
    });

    const decision = await service.decide(makeInput());
    // sticky 命中 c_chat endpoint。
    expect(decision.stickyHit).toBe(true);
    expect(decision.candidates[0]!.endpoint.id).toBe('ep_uk1_chat');
  });

  it('does not sticky-match when the recorded endpoint is not available', async () => {
    // sticky 记录 endpoint X，但 X 不在候选 endpoint 列表里 → 不命中。
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1', { baseUrl: 'https://api.example.com' })],
      endpoints: [makeEndpoint('ep_uk1_chat', 'uk1', { baseUrl: 'https://api.example.com' })],
      candidates: [
        makeCandidate({
          id: 'c_chat',
          providerAccountId: 'uk1',
          endpointId: 'ep_uk1_chat',
          realModelName: 'a',
        }),
      ],
      stickyBinding: {
        providerAccountId: 'uk1',
        realModelName: 'a',
        endpointId: 'ep_does_not_exist',
      },
    });

    const decision = await service.decide(makeInput());
    expect(decision.stickyHit).toBe(false);
  });

  it('expands channel members by priority', async () => {
    const service = createService({
      providerAccounts: [makeProviderAccount('uk1'), makeProviderAccount('uk2')],
      members: [
        {
          id: 'm2',
          channelId: 'mg',
          modelId: 'pm2',
          enabled: true,
          priority: 200,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ChannelMemberRow,
        {
          id: 'm1',
          channelId: 'mg',
          modelId: 'pm1',
          enabled: true,
          priority: 50,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ChannelMemberRow,
      ],
      candidates: [
        makeCandidate({
          id: 'c2',
          providerAccountId: 'uk2',
          modelId: 'pm2',
          realModelName: 'real-2',
        }),
        makeCandidate({
          id: 'c1',
          providerAccountId: 'uk1',
          modelId: 'pm1',
          realModelName: 'real-1',
        }),
      ],
    });

    const input = makeInput({
      resolvedTarget: { type: 'channel', id: 'mg', name: 'fast', entity: undefined as never },
    });

    const decision = await service.decide(input);
    expect(decision.resolvedTargetType).toBe('channel');
    expect(decision.candidates.map((c) => c.realModelName)).toEqual(['real-1', 'real-2']);
  });

  it('binds candidate to a single endpoint (1 candidate = 1 endpoint, no cartesian expansion)', async () => {
    // 同一 providerAccount 有 2 个 endpoint：每个 candidate 只绑定一个 endpoint。
    const service = createService({
      providerAccounts: [
        makeProviderAccount('uk1', {
          providerType: 'openai_compatible',
          baseUrl: 'https://api.example.com',
        }),
      ],
      endpoints: [
        makeEndpoint('ep_uk1_main', 'uk1', {
          baseUrl: 'https://api.example.com',
          path: '/v1',
        }),
        makeEndpoint('ep_uk1_alt', 'uk1', {
          baseUrl: 'https://api.alt.example.com',
          path: '/v1',
        }),
      ],
      // 显式为每个 endpoint 创建一个 candidate
      candidates: [
        makeCandidate({
          id: 'c_main',
          providerAccountId: 'uk1',
          endpointId: 'ep_uk1_main',
        }),
        makeCandidate({
          id: 'c_alt',
          providerAccountId: 'uk1',
          endpointId: 'ep_uk1_alt',
        }),
      ],
    });

    const decision = await service.decide(makeInput());
    // 2 个 candidate → 2 个 snapshot，不做笛卡尔积。
    expect(decision.candidates).toHaveLength(2);
    const endpointIds = decision.candidates.map((c) => c.endpoint.id).sort();
    expect(endpointIds).toEqual(['ep_uk1_alt', 'ep_uk1_main']);
  });

  it('prefers native OpenAI endpoint for OpenAI client request on Moonshot upstream', async () => {
    const service = createService({
      providerAccounts: [
        makeProviderAccount('moonshot', {
          providerType: 'openai_compatible',
          baseUrl: 'https://api.moonshot.ai',
        }),
      ],
      candidates: [makeCandidate({ providerAccountId: 'moonshot', realModelName: 'kimi-latest' })],
    });

    const input = makeInput({
      ir: {
        sourceProtocol: 'openai',
        requestedModel: 'kimi',
        system: null,
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: null,
        temperature: null,
        topP: null,
        stream: false,
        metadata: {},
        rawRequest: { model: 'kimi', messages: [{ role: 'user', content: 'Hello' }] },
      },
    });

    const decision = await service.decide(input);
    expect(decision.candidates).toHaveLength(1);
    expect(decision.candidates[0]).toMatchObject({
      providerAccount: { id: 'moonshot' },
      realModelName: 'kimi-latest',
      protocolConversion: 'native',
    });
  });

  it('prefers native Anthropic endpoint for Anthropic client request on Moonshot upstream', async () => {
    const service = createService({
      providerAccounts: [
        makeProviderAccount('moonshot', {
          providerType: 'anthropic_compatible',
          baseUrl: 'https://api.moonshot.ai/anthropic',
        }),
      ],
      candidates: [makeCandidate({ providerAccountId: 'moonshot', realModelName: 'kimi-latest' })],
    });

    const input = makeInput({
      ir: {
        sourceProtocol: 'anthropic',
        requestedModel: 'kimi',
        system: null,
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: null,
        temperature: null,
        topP: null,
        stream: false,
        metadata: {},
        rawRequest: { model: 'kimi', messages: [{ role: 'user', content: 'Hello' }] },
      },
    });

    const decision = await service.decide(input);
    expect(decision.candidates).toHaveLength(1);
    expect(decision.candidates[0]).toMatchObject({
      providerAccount: { id: 'moonshot' },
      realModelName: 'kimi-latest',
      protocolConversion: 'native',
    });
  });

  it('drops unsupported protocol endpoints with trace', async () => {
    const service = createService({
      providerAccounts: [
        makeProviderAccount('uk1', {
          providerType: 'anthropic_compatible',
          baseUrl: 'https://api.example.com',
        }),
      ],
      candidates: [makeCandidate({ providerAccountId: 'uk1' })],
    });

    const input = makeInput({
      ir: {
        sourceProtocol: 'codex',
        requestedModel: 'gpt-4o',
        system: null,
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: null,
        temperature: null,
        topP: null,
        stream: false,
        metadata: {},
        rawRequest: { model: 'gpt-4o' },
      },
    });

    const decision = await service.decide(input);
    expect(decision.candidates).toHaveLength(0);
    expect(decision.traceEvents.some((e) => e.step === 'filter_protocol_unsupported')).toBe(true);
  });

  it('drops convertible Anthropic endpoint when OpenAI tools request would lose fields', async () => {
    const service = createService({
      providerAccounts: [
        makeProviderAccount('uk1', {
          providerType: 'anthropic_compatible',
          baseUrl: 'https://api.example.com',
        }),
      ],
      candidates: [makeCandidate({ providerAccountId: 'uk1' })],
    });

    const input = makeInput({
      ir: {
        sourceProtocol: 'openai',
        requestedModel: 'gpt-4o',
        system: null,
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: null,
        temperature: null,
        topP: null,
        stream: false,
        metadata: {},
        rawRequest: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
          tools: [{ type: 'function', function: { name: 'search', description: 'x' } }],
        },
      },
    });

    const decision = await service.decide(input);
    expect(decision.candidates).toHaveLength(0);
    expect(
      decision.traceEvents.some((e) => e.step === 'filter_protocol_advanced_unsupported'),
    ).toBe(true);
  });

  it('keeps native OpenAI endpoint for OpenAI tools request and drops convertible Anthropic endpoint', async () => {
    const service = createService({
      providerAccounts: [
        makeProviderAccount('moonshot', {
          providerType: 'openai_compatible',
          baseUrl: 'https://api.moonshot.ai',
        }),
      ],
      candidates: [makeCandidate({ providerAccountId: 'moonshot', realModelName: 'kimi-latest' })],
    });

    const input = makeInput({
      ir: {
        sourceProtocol: 'openai',
        requestedModel: 'kimi',
        system: null,
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: null,
        temperature: null,
        topP: null,
        stream: false,
        metadata: {},
        rawRequest: {
          model: 'kimi',
          messages: [{ role: 'user', content: 'Hello' }],
          tools: [{ type: 'function', function: { name: 'search', description: 'x' } }],
        },
      },
    });

    const decision = await service.decide(input);
    expect(decision.candidates).toHaveLength(1);
    expect(decision.candidates[0]!.protocolConversion).toBe('native');
  });
});
