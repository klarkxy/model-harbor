import {
  isNormalizedError,
  NoRouteAvailableError,
  PermissionError,
  ProviderError,
  ProviderTimeoutError,
  getErrorRoutingBehavior,
  type ChatRequestIR,
  type NormalizedChatResponse,
  type NormalizedError,
} from '@manageyourllm/shared';
import { ModelRepository } from '../infrastructure/db/repositories/model.repository.js';
import { ChannelRepository } from '../infrastructure/db/repositories/channel.repository.js';
import { ProviderAccountRepository } from '../infrastructure/db/repositories/provider-account.repository.js';
import { RoutingStateRepository } from '../infrastructure/db/repositories/routing-state.repository.js';
import { EndpointRepository } from '../infrastructure/db/repositories/endpoint.repository.js';
import type { Db } from '../infrastructure/db/client.js';
import type { ClientKeyRow, ClientRow } from '../infrastructure/db/schema.js';
import { TargetResolutionService } from './target-resolution.service.js';
import { AccessPolicyService } from './access-policy.service.js';
import { RoutingDecisionService } from './routing-decision.service.js';
import { SettingsService } from './settings.service.js';
import { mapSettingsRowToSnapshot } from './snapshots.js';
import { UpstreamAuthResolver } from '../gateway/upstream-auth-resolver.js';
import { UpstreamSender } from '../gateway/upstream-sender.js';
import { getProviderAdapter } from '../gateway/providers/registry.js';
import { mapResponseToSourceProtocol } from '../gateway/response-mappers.js';
import { createStreamTransformer } from '../gateway/streaming.js';
import {
  GatewaySideEffectsService,
  type ExecutionBaseInfo,
} from './gateway-side-effects.service.js';
import type { CandidateSnapshot, RoutingDecision } from './routing.types.js';

export interface GatewayExecutionContext {
  db: Db;
  clientKey: ClientKeyRow;
  client: ClientRow;
  requestTraceId: string;
  sourceProtocol?: string;
  requestStartTime?: number;
}

export interface GatewayExecutionDeps {
  db: Db;
  secretKey: string;
  sender?: UpstreamSender;
  authResolver?: UpstreamAuthResolver;
  routingDecisionService?: RoutingDecisionService;
  sideEffectsService?: GatewaySideEffectsService;
}

export interface ModelListItem {
  id: string;
  object: 'model';
  created?: number;
  owned_by?: string;
}

export interface StreamExecutionResult {
  status: number;
  headers: Record<string, string>;
  stream: ReadableStream<Uint8Array>;
}

function toNormalizedError(err: unknown): NormalizedError {
  if (isNormalizedError(err)) return err;
  if (err instanceof Error) return new ProviderError(err.message);
  return new ProviderError(String(err));
}

function isRetriable(err: NormalizedError): boolean {
  // LiteLLM 借鉴：错误类型 -> 路由行为映射表统一收敛到 shared 的
  // getErrorRoutingBehavior，避免 gateway-execution 与 gateway-side-effects 各写一份。
  return getErrorRoutingBehavior(err).failover;
}


interface ExecutionPrepareResult {
  resolved: Awaited<ReturnType<TargetResolutionService['resolve']>>;
  settings: Awaited<ReturnType<SettingsService['getSettings']>>;
  decision: RoutingDecision;
  base: ExecutionBaseInfo;
  sideEffects: GatewaySideEffectsService;
}

export class GatewayExecutionService {
  private readonly db: Db;
  private readonly secretKey: string;
  private readonly sender: UpstreamSender;
  private readonly authResolver: UpstreamAuthResolver;
  private readonly deps: GatewayExecutionDeps;

  constructor(deps: GatewayExecutionDeps) {
    this.db = deps.db;
    this.secretKey = deps.secretKey;
    this.sender = deps.sender ?? new UpstreamSender();
    this.authResolver =
      deps.authResolver ?? new UpstreamAuthResolver({ secretKey: deps.secretKey });
    this.deps = deps;
  }

  async listModels(
    ctx: GatewayExecutionContext,
  ): Promise<{ object: 'list'; data: ModelListItem[] }> {
    const modelRepo = new ModelRepository(ctx.db);
    const channelRepo = new ChannelRepository(ctx.db);

    const [models, channels] = await Promise.all([
      modelRepo.listModels(),
      channelRepo.listChannels(),
    ]);

    // v1 Phase 6 收口：client key 永远是 accessMode='all'，不再做 restricted 过滤。
    const allowedModels = models.filter((m) => m.enabled);
    const allowedChannels = channels.filter((g) => g.enabled);

    // 删除 AccessPolicyService 之前，`/v1/models` 还会按 consumer_key_access
    // 二次过滤。v1 不再需要这个分支（`consumer_key_access` 死表已在 v20 清理）。

    const nowSeconds = Math.floor(Date.now() / 1000);
    const data: ModelListItem[] = [
      ...allowedModels.map((m) => ({
        id: m.name,
        object: 'model' as const,
        created: nowSeconds,
        owned_by: 'manageyourllm',
      })),
      ...allowedChannels.map((g) => ({
        id: g.name,
        object: 'model' as const,
        created: nowSeconds,
        owned_by: 'manageyourllm',
      })),
    ];

    return { object: 'list', data };
  }

  async executeChat(
    ctx: GatewayExecutionContext,
    ir: ChatRequestIR,
  ): Promise<{ status: number; body: unknown }> {
    const { decision, base, sideEffects, settings } = await this.prepareExecution(ctx, ir);

    if (decision.candidates.length === 0) {
      throw new NoRouteAvailableError('当前没有可用的上游路由');
    }

    const maxAttempts =
      settings.defaultRetries && settings.defaultRetries > 0
        ? Math.min(settings.defaultRetries + 1, decision.candidates.length)
        : decision.candidates.length;
    let lastError: NormalizedError | undefined;

    for (let index = 0; index < maxAttempts; index++) {
      const candidate = decision.candidates[index];
      if (!candidate) continue;

      const attemptResult = await this.attemptCandidate(
        ir,
        candidate,
        decision,
        base,
        sideEffects,
        settings,
        index,
      );
      if (attemptResult.ok) {
        return {
          status: 200,
          body: mapResponseToSourceProtocol(
            ir.sourceProtocol,
            ir.requestedModel,
            attemptResult.normalized,
          ),
        };
      }

      lastError = attemptResult.error;
      if (!attemptResult.retriable) {
        throw attemptResult.error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new NoRouteAvailableError('所有上游路由均不可用');
  }

  async executeStream(
    ctx: GatewayExecutionContext,
    ir: ChatRequestIR,
  ): Promise<StreamExecutionResult> {
    const { decision, base, sideEffects, settings } = await this.prepareExecution(ctx, ir);

    if (decision.candidates.length === 0) {
      throw new NoRouteAvailableError('当前没有可用的上游路由');
    }

    const streamCandidates = decision.candidates.filter((c) => {
      const adapter = getProviderAdapter(c.providerType);
      return adapter.supportsStreaming(ir.sourceProtocol, c.endpointProtocol);
    });

    if (streamCandidates.length === 0) {
      await sideEffects.recordTraceEvent(base, {
        step: 'unsupported_stream_protocol',
        stepIndex: 5,
        status: 'fail',
        details: { sourceProtocol: ir.sourceProtocol },
      });
      throw new ProviderError('当前目标没有支持该协议流式转换的候选', {
        code: 'unsupported_stream_conversion',
        status: 400,
      });
    }

    const maxAttempts =
      settings.defaultRetries && settings.defaultRetries > 0
        ? Math.min(settings.defaultRetries + 1, streamCandidates.length)
        : streamCandidates.length;
    let lastError: NormalizedError | undefined;

    for (let index = 0; index < maxAttempts; index++) {
      const candidate = streamCandidates[index];
      if (!candidate) continue;

      const attemptResult = await this.attemptStream(
        ir,
        candidate,
        decision,
        base,
        sideEffects,
        settings,
        index,
      );
      if (attemptResult.ok) {
        return attemptResult.result;
      }

      lastError = attemptResult.error;
      if (!attemptResult.retriable) {
        throw attemptResult.error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new NoRouteAvailableError('所有上游路由均不可用');
  }

  private async prepareExecution(
    ctx: GatewayExecutionContext,
    ir: ChatRequestIR,
  ): Promise<ExecutionPrepareResult> {
    const targetResolution = new TargetResolutionService(this.db);
    const accessPolicy = new AccessPolicyService(this.db);
    const settingsService = new SettingsService(this.db);
    const sideEffects = this.getSideEffectsService();

    const resolved = await targetResolution.resolve(ir.requestedModel);

    const base: ExecutionBaseInfo = {
      requestTraceId: ctx.requestTraceId,
      clientId: ctx.client.id,
      clientKeyId: ctx.clientKey.id,
      requestedTargetName: ir.requestedModel,
      resolvedTargetType: resolved.type,
      resolvedTargetId: resolved.id,
    };

    await sideEffects.recordTraceEvent(base, {
      step: 'request_start',
      stepIndex: 0,
      status: 'ok',
      details: {
        sourceProtocol: ctx.sourceProtocol ?? ir.sourceProtocol,
        stream: ir.stream,
        requestedModel: ir.requestedModel,
        requestStartTime: ctx.requestStartTime ?? null,
      },
    });

    await sideEffects.recordTraceEvent(base, {
      step: 'target_resolve',
      stepIndex: 1,
      status: 'ok',
      details: {
        targetType: resolved.type,
        targetId: resolved.id,
        targetName: resolved.name,
      },
    });

    const access = await accessPolicy.checkAccess(ctx.clientKey, ir.requestedModel);
    if (!access.allowed) {
      await sideEffects.recordTraceEvent(base, {
        step: 'access_allowed',
        stepIndex: 2,
        status: 'fail',
        details: { allowed: false, accessMode: ctx.clientKey.accessMode },
      });
      throw new PermissionError('无权访问该目标模型');
    }

    // Trace 应当忠实反映本次请求**实际生效**的访问模式，而不是 DB 行的字面值。
    // v1 永远为 'all'，但 DB 里可能还残留旧的 'restricted' 行（schema 未迁移）；
    // 如果直接写 ctx.clientKey.accessMode，会让排查者误以为 access policy 仍在生效。
    await sideEffects.recordTraceEvent(base, {
      step: 'access_allowed',
      stepIndex: 2,
      status: 'ok',
      details: { allowed: true, accessMode: 'all' },
    });

    const settings = await settingsService.getSettings();
    const decision = await this.makeRoutingDecision(ctx, ir, resolved, settings);

    await sideEffects.recordDecisionTraceEvents(base, decision.traceEvents, 10);

    return { resolved, settings, decision, base, sideEffects };
  }

  private async makeRoutingDecision(
    ctx: GatewayExecutionContext,
    ir: ChatRequestIR,
    resolved: Awaited<ReturnType<TargetResolutionService['resolve']>>,
    settings: Awaited<ReturnType<SettingsService['getSettings']>>,
  ) {
    const decisionService =
      this.deps?.routingDecisionService ??
      new RoutingDecisionService(
        new ModelRepository(this.db),
        new ChannelRepository(this.db),
        new ProviderAccountRepository(this.db),
        new RoutingStateRepository(this.db),
        new EndpointRepository(this.db),
      );

    return decisionService.decide({
      ir,
      resolvedTarget: resolved,
      clientKeyId: ctx.clientKey.id,
      clientId: ctx.client.id,
      settings: mapSettingsRowToSnapshot(settings),
      now: new Date(),
    });
  }

  private async attemptCandidate(
    ir: ChatRequestIR,
    candidate: CandidateSnapshot,
    decision: RoutingDecision,
    base: ExecutionBaseInfo,
    sideEffects: GatewaySideEffectsService,
    settings: Awaited<ReturnType<SettingsService['getSettings']>>,
    index: number,
  ): Promise<
    | { ok: true; normalized: NormalizedChatResponse }
    | { ok: false; error: NormalizedError; retriable: boolean }
  > {
    try {
      const adapter = getProviderAdapter(candidate.providerType);
      const authHeaders = await this.authResolver.resolveAuthHeaders(candidate.providerAccount);
      const upstreamRequest = adapter.buildRequest({
        providerAccount: candidate.providerAccount,
        endpointUrl: candidate.endpointUrl,
        endpointProtocol: candidate.endpointProtocol,
        endpointPath: candidate.endpoint.path,
        realModelName: candidate.realModelName,
        ir,
        authHeaders,
      });

      const upstreamResponse = await this.sender.send({
        ...upstreamRequest,
        timeoutMs: settings.defaultRequestTimeoutMs ?? 30_000,
      });

      if (upstreamResponse.status >= 200 && upstreamResponse.status < 300) {
        const normalized = adapter.normalizeResponse({
          providerAccount: candidate.providerAccount,
          realModelName: candidate.realModelName,
          sourceProtocol: ir.sourceProtocol,
          endpointProtocol: candidate.endpointProtocol,
          status: upstreamResponse.status,
          headers: upstreamResponse.headers,
          body: upstreamResponse.body,
        });

        await sideEffects.recordOutcome(
          base,
          candidate,
          {
            ...base,
            providerAccountId: candidate.providerAccount.id,
            realModelName: candidate.realModelName,
            sourceProtocol: ir.sourceProtocol,
            providerType: candidate.providerType,
            stream: ir.stream,
            stickyHit: decision.stickyHit,
            sessionStickyHit: decision.sessionStickyHit,
            conversationFingerprint: decision.conversationFingerprint,
            latencyMs: upstreamResponse.latencyMs,
            success: true,
            usage: normalized.usage,
          },
          settings,
        );

        await sideEffects.recordDebugContent(
          base,
          settings,
          ir.messages,
          upstreamResponse.body,
          normalized.usage,
        );

        return { ok: true, normalized };
      }

      const error = adapter.normalizeError({
        providerAccount: candidate.providerAccount,
        realModelName: candidate.realModelName,
        status: upstreamResponse.status,
        body: upstreamResponse.body,
      });

      await this.recordAttemptFailure(
        base,
        sideEffects,
        candidate,
        decision,
        ir.sourceProtocol,
        ir.stream,
        error,
        index,
        upstreamResponse.latencyMs,
        settings,
      );
      return { ok: false, error, retriable: isRetriable(error) };
    } catch (err) {
      const error = toNormalizedError(err);
      await this.recordAttemptFailure(
        base,
        sideEffects,
        candidate,
        decision,
        ir.sourceProtocol,
        ir.stream,
        error,
        index,
        0,
        settings,
      );
      return { ok: false, error, retriable: isRetriable(error) };
    }
  }

  private async attemptStream(
    ir: ChatRequestIR,
    candidate: CandidateSnapshot,
    decision: RoutingDecision,
    base: ExecutionBaseInfo,
    sideEffects: GatewaySideEffectsService,
    settings: Awaited<ReturnType<SettingsService['getSettings']>>,
    index: number,
  ): Promise<
    | { ok: true; result: StreamExecutionResult }
    | { ok: false; error: NormalizedError; retriable: boolean }
  > {
    const streamStartTime = Date.now();
    const recordStreamEvent = async (
      step: string,
      stepIndex: number,
      status: string,
      details?: Record<string, unknown>,
    ) => {
      await sideEffects.recordTraceEvent(base, {
        step,
        stepIndex,
        providerAccountId: candidate.providerAccount.id,
        realModelName: candidate.realModelName,
        status,
        details,
      });
    };

    try {
      const adapter = getProviderAdapter(candidate.providerType);
      const authHeaders = await this.authResolver.resolveAuthHeaders(candidate.providerAccount);
      const upstreamRequest = adapter.buildRequest({
        providerAccount: candidate.providerAccount,
        endpointUrl: candidate.endpointUrl,
        endpointProtocol: candidate.endpointProtocol,
        endpointPath: candidate.endpoint.path,
        realModelName: candidate.realModelName,
        ir,
        authHeaders,
      });

      await recordStreamEvent('stream_start', 2000, 'ok', {
        providerAccountId: candidate.providerAccount.id,
        realModelName: candidate.realModelName,
      });

      const upstreamResponse = await this.sender.sendStream({
        ...upstreamRequest,
        timeoutMs: settings.defaultRequestTimeoutMs ?? 30_000,
        firstTokenTimeoutMs: settings.firstTokenTimeoutMs ?? 15_000,
      });

      if (!upstreamResponse.ok) {
        const error = adapter.normalizeError({
          providerAccount: candidate.providerAccount,
          realModelName: candidate.realModelName,
          status: upstreamResponse.status,
          body: upstreamResponse.body,
        });
        await recordStreamEvent('stream_error', 2003, 'fail', {
          errorCode: error.code,
          errorMessage: error.message,
          upstreamStatus: upstreamResponse.status,
        });
        await this.recordAttemptFailure(
          base,
          sideEffects,
          candidate,
          decision,
          ir.sourceProtocol,
          ir.stream,
          error,
          index,
          0,
          settings,
        );
        return { ok: false, error, retriable: isRetriable(error) };
      }

      const transformer = createStreamTransformer({
        requestedModel: ir.requestedModel,
        sourceProtocol: ir.sourceProtocol,
        endpointProtocol: candidate.endpointProtocol,
        streamStartTime,
        onUsage: (usage) => {
          sideEffects
            .recordOutcome(
              base,
              candidate,
              {
                ...base,
                providerAccountId: candidate.providerAccount.id,
                realModelName: candidate.realModelName,
                sourceProtocol: ir.sourceProtocol,
                providerType: candidate.providerType,
                stream: ir.stream,
                stickyHit: decision.stickyHit,
                sessionStickyHit: decision.sessionStickyHit,
                conversationFingerprint: decision.conversationFingerprint,
                latencyMs: 0,
                success: true,
                usage,
              },
              settings,
            )
            .catch(() => {});
        },
        onComplete: ({ content, usage }) => {
          sideEffects
            .recordDebugContent(base, settings, ir.messages, { content }, usage)
            .catch(() => {});
        },
        onFirstToken: (latencyMs) => {
          recordStreamEvent('first_token', 2001, 'ok', { latencyMs }).catch(() => {});
        },
        onStreamEnd: (usage) => {
          recordStreamEvent('stream_end', 2002, 'ok', {
            inputTokens: usage?.inputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
            totalTokens: usage?.totalTokens ?? null,
          }).catch(() => {});
        },
        onError: (error) => {
          recordStreamEvent('stream_error', 2003, 'fail', {
            errorCode: 'stream_parse_error',
            errorMessage: error.message,
          }).catch(() => {});
        },
      });

      const stream = upstreamResponse.body.pipeThrough(transformer);

      return {
        ok: true,
        result: {
          status: 200,
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          },
          stream,
        },
      };
    } catch (err) {
      const error = toNormalizedError(err);
      if (error instanceof ProviderTimeoutError) {
        await recordStreamEvent('first_token_timeout', 2004, 'fail', {
          errorCode: error.code,
          errorMessage: error.message,
        });
      }
      await this.recordAttemptFailure(
        base,
        sideEffects,
        candidate,
        decision,
        ir.sourceProtocol,
        ir.stream,
        error,
        index,
        0,
        settings,
      );
      return { ok: false, error, retriable: isRetriable(error) };
    }
  }

  private async recordAttemptFailure(
    base: ExecutionBaseInfo,
    sideEffects: GatewaySideEffectsService,
    candidate: CandidateSnapshot,
    decision: RoutingDecision,
    sourceProtocol: ChatRequestIR['sourceProtocol'],
    stream: boolean,
    error: NormalizedError,
    index: number,
    latencyMs: number,
    settings: Awaited<ReturnType<SettingsService['getSettings']>>,
  ): Promise<void> {
    await sideEffects.recordTraceEvent(base, {
      step: 'upstream_attempt_failed',
      stepIndex: 1000 + index,
      providerAccountId: candidate.providerAccount.id,
      realModelName: candidate.realModelName,
      status: 'fail',
      errorCode: error.code,
      errorMessage: error.message,
    });

    await sideEffects.recordOutcome(
      base,
      candidate,
      {
        ...base,
        providerAccountId: candidate.providerAccount.id,
        realModelName: candidate.realModelName,
        sourceProtocol,
        providerType: candidate.providerType,
        stream,
        stickyHit: decision.stickyHit,
        sessionStickyHit: decision.sessionStickyHit,
        conversationFingerprint: decision.conversationFingerprint,
        latencyMs,
        success: false,
        usage: null,
        error,
      },
      settings,
    );
  }

  private getSideEffectsService(): GatewaySideEffectsService {
    return this.deps?.sideEffectsService ?? new GatewaySideEffectsService(this.db);
  }
}
