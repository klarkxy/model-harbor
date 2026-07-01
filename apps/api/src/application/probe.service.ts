import { UpstreamSender } from '../gateway/upstream-sender.js';
import { UpstreamAuthResolver } from '../gateway/upstream-auth-resolver.js';
import { ProviderAccountRepository } from '../infrastructure/db/repositories/provider-account.repository.js';
import { EndpointRepository } from '../infrastructure/db/repositories/endpoint.repository.js';
import { protocolFor, type SourceProtocol } from '@manageyourllm/shared';
import type { UpstreamEndpoint } from '../domain/gateway/routing-policy.js';
import type { Db } from '../infrastructure/db/client.js';
import type { EndpointRow, ProviderAccountRow } from '../infrastructure/db/schema.js';

export interface ProbeServiceDeps {
  db: Db;
  secretKey: string;
  sender?: UpstreamSender;
}

export interface DiscoveredModel {
  id: string;
  object: string;
  ownedBy?: string;
}

export interface PingResult {
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

export interface ProbeOptions {
  endpointId: string;
  model?: string;
}

function protocolOfEndpoint(endpoint: UpstreamEndpoint): SourceProtocol {
  return endpoint.protocol ?? protocolFor(endpoint.providerType);
}

function discoveryEndpoint(endpoints: EndpointRow[]): EndpointRow {
  const openai = endpoints.find(
    (e) => e.providerType === 'openai_compatible' || e.protocol === 'openai',
  );
  return openai ?? endpoints[0]!;
}

function chatCompletionPathFor(endpoint: UpstreamEndpoint): string {
  const protocol = protocolOfEndpoint(endpoint);
  if (protocol === 'anthropic') return '/v1/messages';
  if (protocol === 'codex') return '/v1/responses';
  return '/v1/chat/completions';
}

function defaultModelFor(endpoint: UpstreamEndpoint): string {
  const protocol = protocolOfEndpoint(endpoint);
  if (protocol === 'anthropic') return 'claude-3-haiku-20240307';
  if (protocol === 'codex') return 'codex-mini';
  return 'gpt-3.5-turbo';
}

function endpointBaseUrl(endpoint: UpstreamEndpoint): string {
  // 只返回 base URL，不拼接 apiPath；apiPath 由 chatCompletionPathFor / health-check 路径按需拼接，
  // 避免用户自定义的 path 与硬编码的 API 路径重复。
  return endpoint.baseUrl.replace(/\/$/, '');
}

function endpointRowToUpstream(row: EndpointRow): UpstreamEndpoint {
  return {
    protocol: (row.protocol as SourceProtocol) ?? protocolFor(row.providerType),
    baseUrl: row.baseUrl,
    providerType: row.providerType,
    ...(row.defaultHeadersJson ? { defaultHeaders: row.defaultHeadersJson } : {}),
    ...(row.extraHeadersJson ? { extraHeaders: row.extraHeadersJson } : {}),
    ...(row.extraParamsJson ? { extraParams: row.extraParamsJson } : {}),
  };
}

/**
 * Phase 2 Slice 2：probe service。
 *
 * probe / discover 只从 `endpoints` 行表读，不再有 JSON 兜底。
 * 调用方必须显式提供 endpointId。
 */
export class ProbeService {
  private readonly accountRepo: ProviderAccountRepository;
  private readonly endpointRepo: EndpointRepository;
  private readonly authResolver: UpstreamAuthResolver;
  private readonly sender: UpstreamSender;

  constructor(private readonly deps: ProbeServiceDeps) {
    this.accountRepo = new ProviderAccountRepository(deps.db);
    this.endpointRepo = new EndpointRepository(deps.db);
    this.authResolver = new UpstreamAuthResolver({ secretKey: deps.secretKey });
    this.sender = deps.sender ?? new UpstreamSender();
  }

  async discoverModels(opts: ProbeOptions): Promise<DiscoveredModel[]> {
    const endpointRow = await this.endpointRepo.findById(opts.endpointId);
    if (!endpointRow) {
      throw new Error('endpoint 不存在');
    }
    if (!endpointRow.enabled) {
      throw new Error('endpoint 已禁用');
    }
    const account = await this.accountRepo.findById(endpointRow.providerAccountId);
    if (!account) {
      throw new Error('Provider Account 不存在');
    }

    const endpoint = endpointRowToUpstream(endpointRow);
    const authHeaders = await this.authResolver.resolveAuthHeaders(account);
    const baseUrl = endpointBaseUrl(endpoint);
    const url = `${baseUrl.replace(/\/$/, '')}/v1/models`;

    const res = await this.sender.send({
      url,
      method: 'GET',
      headers: {
        ...authHeaders,
        ...(account.defaultHeadersJson ?? {}),
        ...(endpoint.defaultHeaders ?? {}),
      },
      body: null,
      timeoutMs: 30_000,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`上游返回 ${res.status}`);
    }

    const body = res.body as Record<string, unknown> | null;
    const data = body?.data;
    if (!Array.isArray(data)) {
      return [];
    }

    return data
      .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
      .map((m) => ({
        id: String(m.id ?? ''),
        object: String(m.object ?? 'model'),
        ownedBy: m.owned_by ? String(m.owned_by) : undefined,
      }))
      .filter((m) => m.id.length > 0);
  }

  async ping(opts: ProbeOptions): Promise<PingResult> {
    const endpointRow = await this.endpointRepo.findById(opts.endpointId);
    if (!endpointRow) {
      return { ok: false, latencyMs: 0, error: 'endpoint 不存在' };
    }
    if (!endpointRow.enabled) {
      return { ok: false, latencyMs: 0, error: 'endpoint 已禁用' };
    }
    const account = await this.accountRepo.findById(endpointRow.providerAccountId);
    if (!account) {
      return { ok: false, latencyMs: 0, error: 'Provider Account 不存在' };
    }

    const endpoint = endpointRowToUpstream(endpointRow);
    const model =
      opts.model ??
      (account.supportedModelsJson.length > 0
        ? account.supportedModelsJson[0]
        : defaultModelFor(endpoint));
    if (!model) {
      return { ok: false, latencyMs: 0, error: '未指定模型且上游没有默认模型' };
    }

    const authHeaders = await this.authResolver.resolveAuthHeaders(account);
    const baseUrl = endpointBaseUrl(endpoint);
    const url = `${baseUrl.replace(/\/$/, '')}${chatCompletionPathFor(endpoint)}`;

    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    };

    const startedAt = performance.now();
    try {
      const res = await this.sender.send({
        url,
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
          ...(account.defaultHeadersJson ?? {}),
          ...(endpoint.defaultHeaders ?? {}),
        },
        body,
        timeoutMs: 30_000,
      });
      const latencyMs = Math.round(performance.now() - startedAt);

      if (res.status >= 200 && res.status < 300) {
        return { ok: true, latencyMs, error: null };
      }
      const errorBody = res.body as { error?: { message?: string } } | undefined;
      const message = errorBody?.error?.message ?? `上游返回 ${res.status}`;
      return { ok: false, latencyMs, error: message };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - startedAt);
      return { ok: false, latencyMs, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * 选 account 的第一个 enabled endpoint（OpenAI 兼容优先）。
   * 用于 "/admin/provider-accounts/:id/discover" 和 ":id/ping" 在没指定 endpointId 时给一个默认。
   */
  async pickDefaultEndpoint(account: ProviderAccountRow): Promise<EndpointRow | undefined> {
    const rows = await this.endpointRepo.listByProviderAccount(account.id);
    const enabled = rows.filter((r) => r.enabled);
    if (enabled.length === 0) return undefined;
    return discoveryEndpoint(enabled);
  }
}
