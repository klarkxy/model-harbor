import { UpstreamAuthResolver } from '../gateway/upstream-auth-resolver.js';
import { UpstreamSender } from '../gateway/upstream-sender.js';
import type { Db } from '../infrastructure/db/client.js';
import { EndpointHealthRepository } from '../infrastructure/db/repositories/endpoint-health.repository.js';
import { ProviderAccountRepository } from '../infrastructure/db/repositories/provider-account.repository.js';
import { EndpointRepository } from '../infrastructure/db/repositories/endpoint.repository.js';
import { SettingsService } from './settings.service.js';
import { protocolFor } from '@manageyourllm/shared';
import type { UpstreamEndpoint } from '../domain/gateway/routing-policy.js';
import type {
  EndpointRow,
  ProviderAccountRow,
  AdminSettingsRow,
  EndpointHealthRow,
} from '../infrastructure/db/schema.js';
import type { PingResult } from './probe.service.js';

export interface EndpointHealthWorkerDeps {
  db: Db;
  secretKey: string;
  sender?: UpstreamSender;
}

export type EndpointHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export class EndpointHealthWorker {
  private readonly healthRepo: EndpointHealthRepository;
  private readonly accountRepo: ProviderAccountRepository;
  private readonly endpointRepo: EndpointRepository;
  private readonly authResolver: UpstreamAuthResolver;
  private readonly sender: UpstreamSender;
  private readonly settingsService: SettingsService;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: EndpointHealthWorkerDeps) {
    this.healthRepo = new EndpointHealthRepository(deps.db);
    this.accountRepo = new ProviderAccountRepository(deps.db);
    this.endpointRepo = new EndpointRepository(deps.db);
    this.authResolver = new UpstreamAuthResolver({ secretKey: deps.secretKey });
    this.sender = deps.sender ?? new UpstreamSender();
    this.settingsService = new SettingsService(deps.db);
  }

  start(intervalMs: number): void {
    this.stop();
    this.timer = setInterval(() => {
      this.probeAll().catch(() => {});
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async probeAll(): Promise<void> {
    const settings = await this.settingsService.getSettings();
    if (!settings.endpointHealthProbeEnabled) return;

    const accounts = await this.accountRepo.listProviderAccounts();
    const activeAccounts = accounts.filter((k) => k.enabled && !k.frozen);

    await Promise.all(
      activeAccounts.map((account) => this.probeAccount(account, settings).catch(() => {})),
    );
  }

  /**
   * Probe 一个 Provider Account 的所有 enabled endpoints。
   * 不再把任何聚合状态写回到 Provider Account 行；
   * 每个 endpoint 的最新 health 写 `endpoint_health` 表（FK endpoint_id）。
   */
  async probeAccount(
    account: ProviderAccountRow,
    settings?: AdminSettingsRow,
    now = new Date(),
  ): Promise<PingResult> {
    const resolvedSettings = settings ?? (await this.settingsService.getSettings());
    const timeoutMs = resolvedSettings.endpointHealthProbeTimeoutMs;
    const degradedLatencyMs = resolvedSettings.endpointHealthProbeDegradedLatencyMs;

    const endpoints = await this.endpointRepo.listByProviderAccount(account.id);
    const enabled = endpoints.filter((e) => e.enabled);
    if (enabled.length === 0) {
      return { ok: false, latencyMs: 0, error: '无可用端点' };
    }

    const authHeaders = await this.authResolver.resolveAuthHeaders(account);

    const probeResults = await Promise.all(
      enabled.map(
        async (endpointRow): Promise<{ result: PingResult; status: EndpointHealthStatus }> => {
          const endpoint = endpointRowToUpstream(endpointRow);
          const baseUrl = endpoint.baseUrl.replace(/\/$/, '');
          const url = `${endpoint.apiPath ? `${baseUrl}${endpoint.apiPath.startsWith('/') ? '' : '/'}${endpoint.apiPath}` : baseUrl}/v1/models`;
          const startedAt = performance.now();

          try {
            const res = await this.sender.send({
              url,
              method: 'GET',
              headers: {
                ...authHeaders,
                ...(account.defaultHeadersJson ?? {}),
                ...(endpoint.defaultHeaders ?? {}),
              },
              body: null,
              timeoutMs,
            });
            const latencyMs = Math.round(performance.now() - startedAt);

            const ok = res.status >= 200 && res.status < 300;
            const status: EndpointHealthStatus = ok
              ? latencyMs > degradedLatencyMs
                ? 'degraded'
                : 'healthy'
              : 'unhealthy';
            const result: PingResult = {
              ok,
              latencyMs,
              error: ok ? null : `上游返回 ${res.status}`,
            };

            await this.upsertResult(endpointRow, result, status, now);
            return { result, status };
          } catch (err) {
            const latencyMs = Math.round(performance.now() - startedAt);
            const message = err instanceof Error ? err.message : String(err);
            const result: PingResult = { ok: false, latencyMs, error: message };
            await this.upsertResult(endpointRow, result, 'unhealthy', now);
            return { result, status: 'unhealthy' };
          }
        },
      ),
    );

    return aggregateResult(probeResults).result;
  }

  /**
   * 旧接口 probeOne(account)：保留做向后兼容，委托给 probeAccount。
   */
  async probeOne(
    account: ProviderAccountRow,
    settings?: AdminSettingsRow,
    now = new Date(),
  ): Promise<PingResult> {
    return this.probeAccount(account, settings, now);
  }

  /**
   * 记录一次 ping 结果到 endpoint 的 health 表（FK endpoint_id）。
   * 调用方必须传 endpointId。
   */
  async recordPingResult(
    endpointId: string,
    result: PingResult,
    now = new Date(),
  ): Promise<EndpointHealthRow> {
    const endpointRow = await this.endpointRepo.findById(endpointId);
    if (!endpointRow) {
      throw new Error('endpoint 不存在');
    }
    const settings = await this.settingsService.getSettings();
    const status: EndpointHealthStatus = result.ok
      ? result.latencyMs > settings.endpointHealthProbeDegradedLatencyMs
        ? 'degraded'
        : 'healthy'
      : 'unhealthy';
    return this.upsertResult(endpointRow, result, status, now);
  }

  private async upsertResult(
    endpointRow: EndpointRow,
    result: PingResult,
    status: EndpointHealthStatus,
    now: Date,
  ): Promise<EndpointHealthRow> {
    return this.healthRepo.upsert({
      endpointId: endpointRow.id,
      delayMs: result.latencyMs,
      lastCheckedAt: now,
      degraded: status !== 'healthy',
      errorCode: result.ok ? null : 'probe_failed',
      errorMessage: result.error,
    });
  }
}

function endpointRowToUpstream(row: EndpointRow): UpstreamEndpoint {
  return {
    protocol: row.protocol as UpstreamEndpoint['protocol'],
    baseUrl: row.baseUrl,
    providerType: row.providerType,
    ...(row.path ? { apiPath: row.path } : {}),
    ...(row.defaultHeadersJson ? { defaultHeaders: row.defaultHeadersJson } : {}),
    ...(row.extraHeadersJson ? { extraHeaders: row.extraHeadersJson } : {}),
    ...(row.extraParamsJson ? { extraParams: row.extraParamsJson } : {}),
  };
}

function aggregateResult(results: { result: PingResult; status: EndpointHealthStatus }[]): {
  result: PingResult;
  status: EndpointHealthStatus;
} {
  if (results.length === 0) {
    return { result: { ok: false, latencyMs: 0, error: '无可用端点' }, status: 'unhealthy' };
  }

  const ok = results.every((r) => r.result.ok);
  const anyUnhealthy = results.some((r) => r.status === 'unhealthy');
  const anyDegraded = results.some((r) => r.status === 'degraded');
  const maxLatency = Math.max(...results.map((r) => r.result.latencyMs));
  const firstError = results.find((r) => !r.result.ok)?.result.error ?? null;

  const status: EndpointHealthStatus = anyUnhealthy
    ? 'unhealthy'
    : anyDegraded
      ? 'degraded'
      : 'healthy';

  return {
    result: {
      ok,
      latencyMs: maxLatency,
      error: firstError,
    },
    status,
  };
}

// 保留 protocolFor 以避免 ESLint unused-imports 警告（端点 protocol 推断的 fallback）。
export { protocolFor };
