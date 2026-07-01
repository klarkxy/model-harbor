import { eq, and, inArray } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import { endpoints, type EndpointInsert, type EndpointRow } from '../schema.js';

// Phase 2 Slice 2：endpoint 仓库。

export class EndpointRepository {
  constructor(private readonly db: Db) {}

  async listByProviderAccount(providerAccountId: string): Promise<EndpointRow[]> {
    return this.db
      .select()
      .from(endpoints)
      .where(eq(endpoints.providerAccountId, providerAccountId))
      .orderBy(endpoints.displayOrder, endpoints.id);
  }

  // v1 Phase 9：trace 过滤下拉需要全量 endpoint 列表。
  async listAll(): Promise<EndpointRow[]> {
    return this.db.select().from(endpoints).orderBy(endpoints.displayOrder, endpoints.id);
  }

  async findById(endpointId: string): Promise<EndpointRow | undefined> {
    const rows = await this.db
      .select()
      .from(endpoints)
      .where(eq(endpoints.id, endpointId))
      .limit(1);
    return rows[0];
  }

  async findByIds(ids: string[]): Promise<Map<string, EndpointRow>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.select().from(endpoints).where(inArray(endpoints.id, ids));
    return new Map(rows.map((r) => [r.id, r]));
  }

  async findByBaseUrl(
    providerAccountId: string,
    baseUrl: string,
  ): Promise<EndpointRow | undefined> {
    const rows = await this.db
      .select()
      .from(endpoints)
      .where(
        and(eq(endpoints.providerAccountId, providerAccountId), eq(endpoints.baseUrl, baseUrl)),
      )
      .limit(1);
    return rows[0];
  }

  async create(data: Omit<EndpointInsert, 'id' | 'createdAt' | 'updatedAt'>): Promise<EndpointRow> {
    const now = new Date();
    const row: EndpointInsert = {
      id: generateId('endpoint'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(endpoints).values(row);
    return row as EndpointRow;
  }

  async bulkCreate(
    inputs: Array<Omit<EndpointInsert, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<EndpointRow[]> {
    if (inputs.length === 0) return [];
    const now = new Date();
    const rows: EndpointInsert[] = inputs.map((data) => ({
      id: generateId('endpoint'),
      ...data,
      createdAt: now,
      updatedAt: now,
    }));
    await this.db.insert(endpoints).values(rows);
    return rows as EndpointRow[];
  }

  async update(
    endpointId: string,
    data: Partial<Omit<EndpointInsert, 'id' | 'createdAt' | 'providerAccountId'>>,
  ): Promise<EndpointRow | undefined> {
    const now = new Date();
    await this.db
      .update(endpoints)
      .set({ ...data, updatedAt: now })
      .where(eq(endpoints.id, endpointId));
    return this.findById(endpointId);
  }

  async setEnabled(endpointId: string, enabled: boolean): Promise<EndpointRow | undefined> {
    return this.update(endpointId, { enabled });
  }

  async delete(endpointId: string): Promise<void> {
    await this.db.delete(endpoints).where(eq(endpoints.id, endpointId));
  }

  /**
   * 删除 provider account 下 `source = 'user'` 的所有 endpoint 行，然后插入新行。
   * 用于 `updateProviderAccount` 在事务中同步 endpoints 列表。
   * `source = 'preset'` 的行保留（用户后续 reset 时一并替换）。
   */
  async replaceForProviderAccount(
    providerAccountId: string,
    inputs: Array<Omit<EndpointInsert, 'id' | 'createdAt' | 'updatedAt' | 'providerAccountId'>>,
  ): Promise<EndpointRow[]> {
    await this.db
      .delete(endpoints)
      .where(and(eq(endpoints.providerAccountId, providerAccountId), eq(endpoints.source, 'user')));
    if (inputs.length === 0) return [];
    return this.bulkCreate(inputs.map((data) => ({ ...data, providerAccountId })));
  }

  /**
   * 把 account 的 endpoints 重置为 preset 默认。
   * 删除所有 `source = 'user'` 与 `source = 'preset'` 行，插入 preset 默认行。
   * 返回新行列表。
   */
  async resetToPresetDefaults(
    providerAccountId: string,
    presetEndpoints: Array<{
      protocol?: string;
      baseUrl: string;
      apiPath?: string;
      providerType?: string;
      defaultHeaders?: Record<string, string>;
      extraHeaders?: Record<string, string>;
      extraParams?: Record<string, unknown>;
      capabilities?: unknown[];
    }>,
  ): Promise<EndpointRow[]> {
    await this.db.delete(endpoints).where(eq(endpoints.providerAccountId, providerAccountId));
    if (presetEndpoints.length === 0) return [];
    return this.bulkCreate(
      presetEndpoints.map((ep, index) => ({
        providerAccountId,
        protocol: ep.protocol ?? 'openai',
        baseUrl: ep.baseUrl,
        path: ep.apiPath ?? null,
        providerType: (ep.providerType ?? 'openai_compatible') as EndpointInsert['providerType'],
        defaultHeadersJson: ep.defaultHeaders ?? null,
        extraHeadersJson: ep.extraHeaders ?? null,
        extraParamsJson: ep.extraParams ?? null,
        capabilitiesJson: ep.capabilities ?? [],
        enabled: true,
        displayOrder: 1000 + index,
        isPresetDefault: true,
        source: 'preset' as const,
      })),
    );
  }

  async reorder(items: { id: string; displayOrder: number }[]): Promise<void> {
    const now = new Date();
    for (const item of items) {
      await this.db
        .update(endpoints)
        .set({ displayOrder: item.displayOrder, updatedAt: now })
        .where(eq(endpoints.id, item.id));
    }
  }
}
