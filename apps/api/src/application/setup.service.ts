import { verifyPassword, hashPassword } from '../domain/auth/password.js';
import { AdminUserRepository } from '../infrastructure/db/repositories/admin-user.repository.js';
import { ProviderAccountRepository } from '../infrastructure/db/repositories/provider-account.repository.js';
import { ClientRepository } from '../infrastructure/db/repositories/client.repository.js';
import { ModelRepository } from '../infrastructure/db/repositories/model.repository.js';
import { EndpointRepository } from '../infrastructure/db/repositories/endpoint.repository.js';
import { ProviderAccountService } from './provider-account.service.js';
import { ClientService } from './client.service.js';
import { ModelService } from './model.service.js';
import type { Db } from '../infrastructure/db/client.js';
import type { ProviderAccountInsert, ModelCandidateInsert } from '../infrastructure/db/schema.js';

export interface SetupStatus {
  hasAdmin: boolean;
  needsSetup: boolean;
  hasSafeSecret: boolean;
  hasUpstream: boolean;
  hasModel: boolean;
  hasClientKey: boolean;
  complete: boolean;
}

export interface SetupUpstreamInput {
  name: string;
  providerPresetId?: string | null;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  supportedModels?: string[];
}

export interface SetupModelInput {
  name: string;
  displayName?: string;
  // v1 收口：setup 阶段的 candidate 允许不传 endpointId（service 内部按 providerAccount
  // 自动取第一个 endpoint 补）。正式创建路径（model.service.addCandidate）要求显式传。
  candidates: Array<
    Omit<ModelCandidateInsert, 'id' | 'modelId' | 'createdAt' | 'updatedAt' | 'endpointId'> & {
      endpointId?: string;
    }
  >;
}

export interface SetupClientKeyResult {
  clientKeyId: string;
  rawKey: string;
  clientId: string;
}

export class SetupService {
  constructor(
    private readonly db: Db,
    private readonly secretKey: string,
  ) {}

  private adminRepo(): AdminUserRepository {
    return new AdminUserRepository(this.db);
  }

  private providerAccountRepo(): ProviderAccountRepository {
    return new ProviderAccountRepository(this.db);
  }

  private modelRepo(): ModelRepository {
    return new ModelRepository(this.db);
  }

  private clientRepo(): ClientRepository {
    return new ClientRepository(this.db);
  }

  async getStatus(): Promise<SetupStatus> {
    const [hasAdmin, hasUpstream, hasModel, hasClientKey] = await Promise.all([
      this.adminRepo().hasAdmins(),
      this.providerAccountRepo().hasProviderAccounts(),
      this.modelRepo().hasModels(),
      this.clientRepo().hasClientKeys(),
    ]);
    const hasSafeSecret = this.secretKey !== 'dev-secret-change-me';
    const complete = hasAdmin && hasSafeSecret && hasUpstream && hasModel && hasClientKey;
    return {
      hasAdmin,
      needsSetup: !hasAdmin,
      hasSafeSecret,
      hasUpstream,
      hasModel,
      hasClientKey,
      complete,
    };
  }

  async verifySecurity(
    username: string,
    password: string,
    displayName?: string,
  ): Promise<{ ok: boolean; created: boolean }> {
    const hasAdmin = await this.adminRepo().hasAdmins();
    if (hasAdmin) {
      const admin = await this.adminRepo().findByUsername(username);
      if (!admin || !verifyPassword(password, admin.passwordHash)) {
        return { ok: false, created: false };
      }
      return { ok: true, created: false };
    }

    await this.createFirstAdmin(username, password, displayName);
    return { ok: true, created: true };
  }

  async createFirstAdmin(
    username: string,
    password: string,
    displayName?: string,
  ): Promise<import('../infrastructure/db/schema.js').AdminUserRow> {
    return this.adminRepo().createAdmin({
      username,
      passwordHash: hashPassword(password),
      displayName,
      enabled: true,
    });
  }

  async createProviderAccount(input: SetupUpstreamInput): Promise<{ providerAccountId: string }> {
    const accountService = new ProviderAccountService(this.db, this.secretKey);
    const account = await accountService.createProviderAccount({
      name: input.name,
      providerPresetId: input.providerPresetId,
      providerType: input.providerType as ProviderAccountInsert['providerType'],
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      supportedModels: input.supportedModels,
    });
    // 对外统一返回 `providerAccountId`，不再使用旧名 `upstreamKeyId`。
    return { providerAccountId: account.id };
  }

  async createModels(inputs: SetupModelInput[]): Promise<{ modelIds: string[] }> {
    const service = new ModelService(this.db);
    const endpointRepo = new EndpointRepository(this.db);
    const ids: string[] = [];
    for (const input of inputs) {
      // v1 收口：candidate 必须绑定 endpoint。setup wizard 阶段每个 providerAccount
      // 已通过 preset 创建了默认 endpoint。这里自动取该 account 下第一个 endpoint 填入。
      // （Setup wizard 与正式创建走不同 UX 路径，正式路径要求显式选 endpoint。）
      const candidates = await Promise.all(
        input.candidates.map(async (c) => {
          const endpoints = await endpointRepo.listByProviderAccount(c.providerAccountId);
          if (endpoints.length === 0) {
            throw new Error(
              `setup: provider_account ${c.providerAccountId} 没有 endpoint，无法创建 candidate`,
            );
          }
          return {
            ...c,
            endpointId: endpoints[0]!.id,
          };
        }),
      );
      const model = await service.createModel({
        name: input.name,
        displayName: input.displayName,
        candidates,
      });
      ids.push(model.id);
    }
    return { modelIds: ids };
  }

  async createDefaultClientKey(): Promise<SetupClientKeyResult> {
    // v1 Phase 6：Client 创建时已经自动生成 active key；
    // 这里直接复用 createClient 的返回值（已含 rawKey），并查该 Client
    // 下的 active key 拿 id。
    const clientService = new ClientService(this.db);
    const { client, rawKey } = await clientService.createClient({ name: 'Default Client' });
    const keys = await clientService.listClientKeys(client.id);
    const clientKey = keys.find((k) => !k.revokedAt) ?? keys[0];
    if (!clientKey) {
      throw new Error('createDefaultClientKey: default key not generated');
    }
    return {
      clientKeyId: clientKey.id,
      rawKey,
      clientId: client.id,
    };
  }

  generateTestRequest(baseUrl: string, rawKey: string, modelName: string): string {
    const url = `${baseUrl}/v1/chat/completions`;
    return `curl -X POST ${url} \\\n  -H "Authorization: Bearer ${rawKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${modelName}", "messages": [{"role": "user", "content": "Hello"}]}'`;
  }
}
