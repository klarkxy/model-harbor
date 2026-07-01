import {
  getProviderDescriptor,
  protocolFor,
  type ProviderType,
  type SourceProtocol,
} from '@manageyourllm/shared';
import type { Db } from '../infrastructure/db/client.js';
import { EndpointRepository } from '../infrastructure/db/repositories/endpoint.repository.js';
import { ProviderAccountRepository } from '../infrastructure/db/repositories/provider-account.repository.js';
import { withTransaction } from '../infrastructure/db/unit-of-work.js';
import type { UpstreamEndpoint } from '../domain/gateway/routing-policy.js';
import type { EndpointInsert, EndpointRow } from '../infrastructure/db/schema.js';

const VALID_PROTOCOLS: ReadonlySet<string> = new Set(['openai', 'anthropic', 'codex']);

function isValidSourceProtocol(value: string): value is SourceProtocol {
  return VALID_PROTOCOLS.has(value);
}

export interface CreateEndpointInput {
  providerAccountId: string;
  protocol: SourceProtocol | string;
  baseUrl: string;
  path?: string | null;
  providerType: ProviderType | string;
  defaultHeaders?: Record<string, string> | null;
  extraHeaders?: Record<string, string> | null;
  extraParams?: Record<string, unknown> | null;
  capabilities?: unknown[];
  enabled?: boolean;
  displayOrder?: number;
}

export interface UpdateEndpointInput {
  protocol?: SourceProtocol | string;
  baseUrl?: string;
  path?: string | null;
  providerType?: ProviderType | string;
  defaultHeaders?: Record<string, string> | null;
  extraHeaders?: Record<string, string> | null;
  extraParams?: Record<string, unknown> | null;
  capabilities?: unknown[];
  enabled?: boolean;
  displayOrder?: number;
}

export class EndpointService {
  constructor(private readonly db: Db) {}

  private repo(): EndpointRepository {
    return new EndpointRepository(this.db);
  }

  private accountRepo(): ProviderAccountRepository {
    return new ProviderAccountRepository(this.db);
  }

  async listEndpointsForProviderAccount(providerAccountId: string): Promise<EndpointRow[]> {
    const account = await this.accountRepo().findById(providerAccountId);
    if (!account) {
      throw new Error('Provider Account 不存在');
    }
    return this.repo().listByProviderAccount(providerAccountId);
  }

  // v1 Phase 9：trace 过滤下拉全量 endpoint。
  async listAllEndpoints(): Promise<EndpointRow[]> {
    return this.repo().listAll();
  }

  async getEndpoint(endpointId: string): Promise<EndpointRow | undefined> {
    return this.repo().findById(endpointId);
  }

  async createEndpoint(input: CreateEndpointInput): Promise<EndpointRow> {
    const account = await this.accountRepo().findById(input.providerAccountId);
    if (!account) {
      throw new Error('Provider Account 不存在');
    }
    if (!isValidSourceProtocol(input.protocol)) {
      throw new Error(`非法 protocol: ${input.protocol}`);
    }
    if (!input.baseUrl) {
      throw new Error('baseUrl 不能为空');
    }
    const dup = await this.repo().findByBaseUrl(input.providerAccountId, input.baseUrl);
    if (dup) {
      throw new Error('同一 Provider Account 下 baseUrl 必须唯一');
    }
    return this.repo().create({
      providerAccountId: input.providerAccountId,
      protocol: input.protocol,
      baseUrl: input.baseUrl,
      path: input.path ?? null,
      providerType: input.providerType as EndpointInsert['providerType'],
      defaultHeadersJson: input.defaultHeaders ?? null,
      extraHeadersJson: input.extraHeaders ?? null,
      extraParamsJson: input.extraParams ?? null,
      capabilitiesJson: input.capabilities ?? [],
      enabled: input.enabled ?? true,
      displayOrder: input.displayOrder ?? 1000,
      isPresetDefault: false,
      source: 'user',
    });
  }

  async updateEndpoint(
    endpointId: string,
    input: UpdateEndpointInput,
  ): Promise<EndpointRow | undefined> {
    const existing = await this.repo().findById(endpointId);
    if (!existing) return undefined;
    if (input.protocol !== undefined && !isValidSourceProtocol(input.protocol)) {
      throw new Error(`非法 protocol: ${input.protocol}`);
    }
    if (input.baseUrl !== undefined && input.baseUrl !== existing.baseUrl) {
      const dup = await this.repo().findByBaseUrl(existing.providerAccountId, input.baseUrl);
      if (dup && dup.id !== endpointId) {
        throw new Error('同一 Provider Account 下 baseUrl 必须唯一');
      }
    }
    const patch: Partial<Omit<EndpointInsert, 'id' | 'createdAt' | 'providerAccountId'>> = {};
    if (input.protocol !== undefined) patch.protocol = input.protocol;
    if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
    if (input.path !== undefined) patch.path = input.path;
    if (input.providerType !== undefined) {
      patch.providerType = input.providerType as EndpointInsert['providerType'];
    }
    if (input.defaultHeaders !== undefined) patch.defaultHeadersJson = input.defaultHeaders;
    if (input.extraHeaders !== undefined) patch.extraHeadersJson = input.extraHeaders;
    if (input.extraParams !== undefined) patch.extraParamsJson = input.extraParams;
    if (input.capabilities !== undefined) patch.capabilitiesJson = input.capabilities;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.displayOrder !== undefined) patch.displayOrder = input.displayOrder;
    return this.repo().update(endpointId, patch);
  }

  async setEndpointEnabled(endpointId: string, enabled: boolean): Promise<EndpointRow | undefined> {
    return this.repo().setEnabled(endpointId, enabled);
  }

  async deleteEndpoint(endpointId: string): Promise<void> {
    return this.repo().delete(endpointId);
  }

  /**
   * 恢复 Provider Account 的 endpoints 为 preset 默认。
   * 原子地清空所有行再插入 preset 默认行。
   */
  async resetToPresetDefaults(providerAccountId: string): Promise<EndpointRow[]> {
    const account = await this.accountRepo().findById(providerAccountId);
    if (!account) {
      throw new Error('Provider Account 不存在');
    }
    if (!account.providerPresetId) {
      throw new Error('Provider Account 没有关联 preset');
    }
    const preset = getProviderDescriptor(account.providerPresetId);
    if (!preset) {
      throw new Error('preset 不存在');
    }
    const presetEndpoints = preset.endpoints as unknown as Array<{
      protocol?: string;
      baseUrl: string;
      apiPath?: string;
      providerType?: string;
      defaultHeaders?: Record<string, string>;
      extraHeaders?: Record<string, string>;
      extraParams?: Record<string, unknown>;
      capabilities?: unknown[];
    }>;
    return withTransaction(this.db, async (tx) => {
      const repo = new EndpointRepository(tx);
      return repo.resetToPresetDefaults(providerAccountId, presetEndpoints);
    });
  }

  async reorderEndpoints(items: { id: string; displayOrder: number }[]): Promise<void> {
    return this.repo().reorder(items);
  }

  // --- 便捷：行 → 内部 UpstreamEndpoint shape ---
  // routing-decision 暂未切到 endpoint repo，本方法预留 Phase 4 使用。
  toUpstreamEndpoint(row: EndpointRow): UpstreamEndpoint {
    return {
      protocol: isValidSourceProtocol(row.protocol)
        ? row.protocol
        : protocolFor(row.providerType as ProviderType),
      baseUrl: row.baseUrl,
      ...(row.path ? { apiPath: row.path } : {}),
      providerType: row.providerType,
      ...(row.defaultHeadersJson ? { defaultHeaders: row.defaultHeadersJson } : {}),
      ...(row.extraHeadersJson ? { extraHeaders: row.extraHeadersJson } : {}),
      ...(row.extraParamsJson ? { extraParams: row.extraParamsJson } : {}),
    };
  }
}
