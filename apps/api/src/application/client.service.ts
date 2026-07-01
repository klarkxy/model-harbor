import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../infrastructure/db/client.js';
import { ClientRepository } from '../infrastructure/db/repositories/client.repository.js';
import type { ClientRow, ClientKeyRow } from '../infrastructure/db/schema.js';

export interface RawClientKey {
  clientKey: ClientKeyRow;
  rawKey: string;
}

export interface CreateClientInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
}

export interface UpdateClientInput {
  name?: string;
  description?: string | undefined;
  enabled?: boolean;
}

function generateRawKey(): string {
  return `ck_${randomBytes(24).toString('base64url')}`;
}

function hashRawKey(rawKey: string): { keyHash: string; keyPrefix: string; keySuffix: string } {
  const keyHash = createHash('sha256').update(rawKey).digest('base64url');
  return {
    keyHash,
    keyPrefix: rawKey.slice(0, 4),
    keySuffix: rawKey.slice(-4),
  };
}

/**
 * v1 Phase 6 / Phase 10 收口：ClientService 统一负责 Client 及其 active key。
 *
 * 设计：
 * - 一个 Client 必须有一个 active key（createClient 自动生成并返回 rawKey）。
 * - Key 的 rotate / revoke 操作以 clientId 为主键定位 active key：
 *   - 不再暴露 "consumer key 列表 + 任意 key id 操作" 这种独立管理接口。
 * - deleteClient 会 cascade 删除 client 下的 key（schema 已声明）。
 * - 物理表名已在 v21 migration 收敛为 `client_keys`。
 */
export class ClientService {
  constructor(private readonly db: Db) {}

  private clientRepo(): ClientRepository {
    return new ClientRepository(this.db);
  }

  private async requireActiveKey(clientId: string): Promise<ClientKeyRow> {
    const keys = await this.clientRepo().listClientKeys(clientId);
    const active = keys.find((k) => !k.revokedAt) ?? keys[0];
    if (!active) {
      throw new Error(`Client ${clientId} has no active key`);
    }
    return active;
  }

  // ---- Client CRUD ----

  async listClients(): Promise<ClientRow[]> {
    return this.clientRepo().listClients();
  }

  async getClient(id: string): Promise<ClientRow | undefined> {
    return this.clientRepo().findById(id);
  }

  /**
   * v1 Phase 6：创建 Client 时直接生成 active key。
   * 返回 `{ client, rawKey }` —— 前端一次性展示 rawKey，不允许再次查询。
   */
  async createClient(input: CreateClientInput): Promise<{
    client: ClientRow;
    rawKey: string;
  }> {
    const client = await this.clientRepo().createClient({
      name: input.name,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
    });
    const { rawKey } = await this.createClientKey({
      clientId: client.id,
      name: 'default',
      enabled: client.enabled,
    });
    return { client, rawKey };
  }

  async updateClient(id: string, input: UpdateClientInput): Promise<ClientRow | undefined> {
    return this.clientRepo().updateClient(id, {
      name: input.name,
      description: input.description,
      enabled: input.enabled,
    });
  }

  async deleteClient(id: string): Promise<void> {
    await this.clientRepo().deleteClient(id);
  }

  // ---- Client Active Key 操作（以 clientId 为主键）----

  /** 列出该 client 名下所有 key（v1 通常只有 1 个 active）。 */
  async listClientKeys(clientId: string): Promise<ClientKeyRow[]> {
    return this.clientRepo().listClientKeys(clientId);
  }

  /** 旋转 client 的 active key，返回新的 rawKey。 */
  async rotateActiveKeyByClient(clientId: string): Promise<RawClientKey> {
    const active = await this.requireActiveKey(clientId);
    const result = await this.rotateClientKey(active.id);
    return { clientKey: result.clientKey, rawKey: result.rawKey };
  }

  /** 吊销 client 的 active key。 */
  async revokeActiveKeyByClient(clientId: string): Promise<ClientKeyRow> {
    const active = await this.requireActiveKey(clientId);
    const revoked = await this.revokeClientKey(active.id);
    if (!revoked) {
      throw new Error(`Failed to revoke key for client ${clientId}`);
    }
    return revoked;
  }

  /** 用 raw key 反查 client key（gateway-auth 链路用）。 */
  async verifyRawKey(rawKey: string): Promise<ClientKeyRow | undefined> {
    const { keyHash } = hashRawKey(rawKey);
    return this.clientRepo().findClientKeyByHash(keyHash);
  }

  // ---- Client Key 内部实现（原 ConsumerKeyService / ConsumerKeyRepository）----

  private async createClientKey(input: {
    clientId: string;
    name: string;
    enabled?: boolean;
  }): Promise<RawClientKey> {
    const rawKey = generateRawKey();
    const { keyHash, keyPrefix, keySuffix } = hashRawKey(rawKey);

    const clientKey = await this.clientRepo().createClientKey({
      clientId: input.clientId,
      name: input.name,
      keyHash,
      keyPrefix,
      keySuffix,
      accessMode: 'all',
      enabled: input.enabled ?? true,
    });

    return { clientKey, rawKey };
  }

  private async rotateClientKey(id: string): Promise<RawClientKey> {
    const rawKey = generateRawKey();
    const { keyHash, keyPrefix, keySuffix } = hashRawKey(rawKey);
    const clientKey = await this.clientRepo().updateClientKey(id, {
      keyHash,
      keyPrefix,
      keySuffix,
      revokedAt: null,
      enabled: true,
    });
    if (!clientKey) {
      throw new Error('Client key not found');
    }
    return { clientKey, rawKey };
  }

  private async revokeClientKey(id: string): Promise<ClientKeyRow | undefined> {
    return this.clientRepo().updateClientKey(id, { revokedAt: new Date(), enabled: false });
  }
}
