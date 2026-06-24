import type { Db } from '../infrastructure/db/client.js';
import { UpstreamKeyRepository } from '../infrastructure/db/repositories/upstream-key.repository.js';
import { withTransaction } from '../infrastructure/db/unit-of-work.js';
import { encryptSecret, decryptSecret } from '../domain/upstream/secret-crypto.js';
import type {
  UpstreamKeyInsert,
  UpstreamKeyRow,
  UpstreamKeyQuotaInsert,
  UpstreamAuthType,
} from '../infrastructure/db/schema.js';

export interface CreateUpstreamKeyInput {
  name: string;
  providerPresetId?: string | null;
  providerType: UpstreamKeyInsert['providerType'];
  baseUrl: string;
  authType?: UpstreamAuthType;
  apiKey: string;
  authConfigJson?: string | null;
  defaultHeaders?: Record<string, string>;
  extraHeaders?: Record<string, string>;
  extraParams?: Record<string, unknown>;
  supportedModels?: string[];
  endpoints?: unknown[];
  displayOrder?: number;
  enabled?: boolean;
  stickySessionTtlMs?: number;
  quota?: Omit<UpstreamKeyQuotaInsert, 'id' | 'upstreamKeyId' | 'createdAt' | 'updatedAt'>;
}

export class UpstreamKeyService {
  constructor(
    private readonly db: Db,
    private readonly secretKey: string,
  ) {}

  private repo(): UpstreamKeyRepository {
    return new UpstreamKeyRepository(this.db);
  }

  async createUpstreamKey(input: CreateUpstreamKeyInput): Promise<UpstreamKeyRow> {
    const encrypted = encryptSecret(input.apiKey, this.secretKey);
    const authConfigEncrypted = input.authConfigJson
      ? encryptSecret(input.authConfigJson, this.secretKey)
      : null;

    return withTransaction(this.db, async (tx) => {
      const repo = new UpstreamKeyRepository(tx);
      const upstreamKey = await repo.createUpstreamKey({
        name: input.name,
        providerPresetId: input.providerPresetId ?? null,
        providerType: input.providerType,
        baseUrl: input.baseUrl,
        authType: input.authType ?? 'pat',
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyPrefix: encrypted.prefix,
        authConfigCiphertext: authConfigEncrypted?.ciphertext ?? null,
        defaultHeadersJson: input.defaultHeaders ?? null,
        extraHeadersJson: input.extraHeaders ?? null,
        extraParamsJson: input.extraParams ?? null,
        supportedModelsJson: input.supportedModels ?? [],
        endpointsJson: input.endpoints ?? null,
        displayOrder: input.displayOrder ?? 1000,
        enabled: input.enabled ?? true,
        stickySessionTtlMs: input.stickySessionTtlMs ?? 5 * 60 * 1000,
      });

      if (input.quota) {
        await repo.createQuota({
          upstreamKeyId: upstreamKey.id,
          ...input.quota,
        });
      }

      return upstreamKey;
    });
  }

  async decryptApiKey(upstreamKey: UpstreamKeyRow): Promise<string> {
    return decryptSecret(upstreamKey.apiKeyCiphertext, this.secretKey);
  }

  async updateUpstreamKey(
    id: string,
    input: Partial<Omit<CreateUpstreamKeyInput, 'apiKey' | 'quota'>> & {
      apiKey?: string;
      quota?: Partial<Omit<UpstreamKeyQuotaInsert, 'id' | 'upstreamKeyId' | 'createdAt'>>;
    },
  ): Promise<UpstreamKeyRow | undefined> {
    const patch: Partial<Omit<UpstreamKeyInsert, 'id' | 'createdAt'>> = {
      name: input.name,
      providerPresetId: input.providerPresetId ?? undefined,
      providerType: input.providerType,
      baseUrl: input.baseUrl,
      authType: input.authType,
      authConfigCiphertext: input.authConfigJson
        ? encryptSecret(input.authConfigJson, this.secretKey).ciphertext
        : undefined,
      defaultHeadersJson: input.defaultHeaders ?? undefined,
      extraHeadersJson: input.extraHeaders ?? undefined,
      extraParamsJson: input.extraParams ?? undefined,
      supportedModelsJson: input.supportedModels ?? undefined,
      endpointsJson: input.endpoints ?? undefined,
      displayOrder: input.displayOrder,
      enabled: input.enabled,
      stickySessionTtlMs: input.stickySessionTtlMs,
    };

    if (input.apiKey) {
      const encrypted = encryptSecret(input.apiKey, this.secretKey);
      patch.apiKeyCiphertext = encrypted.ciphertext;
      patch.apiKeyPrefix = encrypted.prefix;
    }

    const updated = await this.repo().updateUpstreamKey(id, patch);
    if (!updated) return undefined;

    if (input.quota) {
      const existing = await this.repo().findQuotaByUpstreamKey(id);
      if (existing) {
        await this.repo().updateQuota(existing.id, input.quota);
      } else if (input.quota.period) {
        await this.repo().createQuota({
          upstreamKeyId: id,
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
  }

  async deleteUpstreamKey(id: string): Promise<void> {
    await this.repo().deleteUpstreamKey(id);
  }
}
