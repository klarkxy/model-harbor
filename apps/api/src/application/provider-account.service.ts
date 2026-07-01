import type { Db } from '../infrastructure/db/client.js';
import { ProviderAccountRepository } from '../infrastructure/db/repositories/provider-account.repository.js';
import { EndpointRepository } from '../infrastructure/db/repositories/endpoint.repository.js';
import { withTransaction } from '../infrastructure/db/unit-of-work.js';
import { encryptSecret, decryptSecret } from '../domain/upstream/secret-crypto.js';
import { protocolFor, getProviderDescriptor, type ProviderType } from '@manageyourllm/shared';
import type {
  ProviderAccountInsert,
  ProviderAccountRow,
  ProviderAccountQuotaInsert,
  ProviderAccountQuotaRow,
  ProviderAuthType,
} from '../infrastructure/db/schema.js';

export interface CreateProviderAccountInput {
  name: string;
  providerPresetId?: string | null;
  providerType: ProviderAccountInsert['providerType'];
  baseUrl: string;
  authType?: ProviderAuthType;
  apiKey: string;
  authConfigJson?: string | null;
  defaultHeaders?: Record<string, string>;
  extraHeaders?: Record<string, string>;
  extraParams?: Record<string, unknown>;
  supportedModels?: string[];
  // Phase 2 Slice 2：可选显式 endpoints 列表；不指定时按 providerPresetId 自动复制。
  endpoints?: Array<{
    protocol: string;
    baseUrl: string;
    apiPath?: string;
    providerType?: string;
    defaultHeaders?: Record<string, string>;
    extraHeaders?: Record<string, string>;
    extraParams?: Record<string, unknown>;
    capabilities?: unknown[];
  }>;
  displayOrder?: number;
  enabled?: boolean;
  frozen?: boolean;
  stickySessionTtlMs?: number;
  quota?: Omit<ProviderAccountQuotaInsert, 'id' | 'providerAccountId' | 'createdAt' | 'updatedAt'>;
}

export interface ReorderProviderAccountInput {
  id: string;
  displayOrder: number;
}

/**
 * Provider Account service。
 *
 * v1 概念：账号 + 密钥 + 冻结 + quota + counter 边界。
 *
 * 创建 / 更新 Provider Account 时同步写入 `endpoints` 行表（EndpointRepository），
 * 不再保留 endpoints JSON 列。preset 默认 endpoints 通过
 * `getProviderDescriptor(presetId).endpoints` 复制。
 */
export class ProviderAccountService {
  constructor(
    private readonly db: Db,
    private readonly secretKey: string,
  ) {}

  async createProviderAccount(input: CreateProviderAccountInput): Promise<ProviderAccountRow> {
    const resolved = this.resolvePresetDefaults(input);
    const encrypted = encryptSecret(input.apiKey, this.secretKey);
    const authConfigEncrypted = input.authConfigJson
      ? encryptSecret(input.authConfigJson, this.secretKey)
      : null;

    return withTransaction(this.db, async (tx) => {
      const accountRepo = new ProviderAccountRepository(tx);
      const endpointRepo = new EndpointRepository(tx);
      const account = await accountRepo.createProviderAccount({
        name: input.name,
        providerPresetId: resolved.providerPresetId ?? null,
        providerType: resolved.providerType,
        baseUrl: resolved.baseUrl,
        authType: input.authType ?? 'pat',
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyPrefix: encrypted.prefix,
        authConfigCiphertext: authConfigEncrypted?.ciphertext ?? null,
        defaultHeadersJson: resolved.defaultHeaders,
        extraHeadersJson: resolved.extraHeaders,
        extraParamsJson: resolved.extraParams,
        supportedModelsJson: input.supportedModels ?? [],
        displayOrder: input.displayOrder ?? 1000,
        enabled: input.enabled ?? true,
        frozen: input.frozen ?? false,
        stickySessionTtlMs: input.stickySessionTtlMs ?? 5 * 60 * 1000,
      });

      await endpointRepo.bulkCreate(
        resolved.endpoints.map((ep, index) => ({
          providerAccountId: account.id,
          protocol:
            ep.protocol ?? protocolFor((ep.providerType as ProviderType) ?? input.providerType),
          baseUrl: ep.baseUrl,
          path: ep.apiPath ?? null,
          providerType: (ep.providerType ??
            input.providerType) as ProviderAccountInsert['providerType'],
          defaultHeadersJson: ep.defaultHeaders ?? null,
          extraHeadersJson: ep.extraHeaders ?? null,
          extraParamsJson: ep.extraParams ?? null,
          capabilitiesJson: ep.capabilities ?? [],
          enabled: true,
          displayOrder: 1000 + index,
          isPresetDefault: input.providerPresetId ? true : false,
          source: input.providerPresetId ? ('preset' as const) : ('user' as const),
        })),
      );

      if (input.quota) {
        await accountRepo.createQuota({
          providerAccountId: account.id,
          ...input.quota,
        });
      }

      return account;
    });
  }

  private resolvePresetDefaults(input: CreateProviderAccountInput): {
    providerPresetId?: string | null;
    providerType: ProviderAccountInsert['providerType'];
    baseUrl: string;
    defaultHeaders: Record<string, string> | null;
    extraHeaders: Record<string, string> | null;
    extraParams: Record<string, unknown> | null;
    endpoints: NonNullable<CreateProviderAccountInput['endpoints']>;
  } {
    if (input.providerPresetId) {
      const preset = getProviderDescriptor(input.providerPresetId);
      if (preset) {
        const endpoints =
          input.endpoints && input.endpoints.length > 0 ? input.endpoints : preset.endpoints;
        const firstEndpoint = endpoints[0];
        return {
          providerPresetId: input.providerPresetId,
          // 使用 preset 自身的 id（如 moonshot）作为顶层 providerType，
          // 而不是第一个 endpoint 的 providerType，避免在元数据层把多协议 provider 固定为单一 endpoint。
          providerType: preset.id as ProviderAccountInsert['providerType'],
          baseUrl: firstEndpoint?.baseUrl ?? input.baseUrl,
          defaultHeaders: { ...preset.defaultHeaders, ...input.defaultHeaders },
          extraHeaders: { ...preset.defaultExtraHeaders, ...input.extraHeaders },
          extraParams: { ...preset.defaultExtraParams, ...input.extraParams },
          endpoints,
        };
      }
    }

    const endpoints =
      input.endpoints && input.endpoints.length > 0
        ? input.endpoints
        : [
            {
              protocol: protocolFor(input.providerType as ProviderType),
              baseUrl: input.baseUrl,
              providerType: input.providerType,
            },
          ];

    return {
      providerPresetId: input.providerPresetId,
      providerType: input.providerType,
      baseUrl: input.baseUrl,
      defaultHeaders: input.defaultHeaders ?? null,
      extraHeaders: input.extraHeaders ?? null,
      extraParams: input.extraParams ?? null,
      endpoints,
    };
  }

  async decryptApiKey(account: ProviderAccountRow): Promise<string> {
    return decryptSecret(account.apiKeyCiphertext, this.secretKey);
  }

  async updateProviderAccount(
    id: string,
    input: Partial<Omit<CreateProviderAccountInput, 'apiKey' | 'quota'>> & {
      apiKey?: string;
      quota?: Partial<Omit<ProviderAccountQuotaInsert, 'id' | 'providerAccountId' | 'createdAt'>>;
    },
  ): Promise<ProviderAccountRow | undefined> {
    const patch: Partial<Omit<ProviderAccountInsert, 'id' | 'createdAt'>> = {
      name: input.name,
      providerPresetId: input.providerPresetId ?? undefined,
      providerType: input.providerType,
      baseUrl: input.baseUrl,
      authType: input.authType,
      defaultHeadersJson: input.defaultHeaders ?? undefined,
      extraHeadersJson: input.extraHeaders ?? undefined,
      extraParamsJson: input.extraParams ?? undefined,
      supportedModelsJson: input.supportedModels ?? undefined,
      displayOrder: input.displayOrder,
      enabled: input.enabled,
      stickySessionTtlMs: input.stickySessionTtlMs,
    };

    if (input.apiKey) {
      const encrypted = encryptSecret(input.apiKey, this.secretKey);
      patch.apiKeyCiphertext = encrypted.ciphertext;
      patch.apiKeyPrefix = encrypted.prefix;
    }

    if (input.authConfigJson !== undefined) {
      patch.authConfigCiphertext = input.authConfigJson
        ? encryptSecret(input.authConfigJson, this.secretKey).ciphertext
        : null;
    }

    return withTransaction(this.db, async (tx) => {
      const accountRepo = new ProviderAccountRepository(tx);
      const endpointRepo = new EndpointRepository(tx);

      const updated = await accountRepo.updateProviderAccount(id, patch);
      if (!updated) return undefined;

      // 显式提供 endpoints 时整批替换 user 源 endpoint 行。
      if (input.endpoints !== undefined) {
        await endpointRepo.replaceForProviderAccount(
          id,
          input.endpoints.map((ep) => ({
            ...ep,
            providerType: (ep.providerType ??
              input.providerType) as ProviderAccountInsert['providerType'],
          })),
        );
      }

      if (input.quota) {
        const existing = await accountRepo.findQuotaByProviderAccount(id);
        if (existing) {
          await accountRepo.updateQuota(existing.id, input.quota);
        } else if (input.quota.period) {
          await accountRepo.createQuota({
            providerAccountId: id,
            period: input.quota.period,
            requestLimit: input.quota.requestLimit ?? null,
            inputTokenLimit: input.quota.inputTokenLimit ?? null,
            outputTokenLimit: input.quota.outputTokenLimit ?? null,
            totalTokenLimit: input.quota.totalTokenLimit ?? null,
            enabled: input.quota.enabled ?? true,
          });
        }
      }

      return updated;
    });
  }

  async deleteProviderAccount(id: string): Promise<void> {
    const repo = new ProviderAccountRepository(this.db);
    await repo.deleteProviderAccount(id);
  }

  async rotateApiKey(id: string, apiKey: string): Promise<ProviderAccountRow | undefined> {
    const encrypted = encryptSecret(apiKey, this.secretKey);
    const repo = new ProviderAccountRepository(this.db);
    return repo.updateProviderAccount(id, {
      apiKeyCiphertext: encrypted.ciphertext,
      apiKeyPrefix: encrypted.prefix,
    });
  }

  async freezeProviderAccount(
    id: string,
    frozen: boolean,
    reason?: string,
  ): Promise<ProviderAccountRow | undefined> {
    const repo = new ProviderAccountRepository(this.db);
    return repo.updateFreeze(id, frozen, reason);
  }

  async listProviderAccounts(): Promise<ProviderAccountRow[]> {
    const repo = new ProviderAccountRepository(this.db);
    return repo.listProviderAccounts();
  }

  async getProviderAccount(id: string): Promise<ProviderAccountRow | undefined> {
    const repo = new ProviderAccountRepository(this.db);
    return repo.findById(id);
  }

  async getQuotaByProviderAccount(id: string): Promise<ProviderAccountQuotaRow | undefined> {
    const repo = new ProviderAccountRepository(this.db);
    return repo.findQuotaByProviderAccount(id);
  }

  async reorderProviderAccounts(items: ReorderProviderAccountInput[]): Promise<void> {
    const repo = new ProviderAccountRepository(this.db);
    for (const item of items) {
      await repo.updateProviderAccount(item.id, { displayOrder: item.displayOrder });
    }
  }
}
