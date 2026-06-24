import { eq, and } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  consumerKeys,
  consumerKeyAccess,
  type ConsumerKeyInsert,
  type ConsumerKeyRow,
  type ConsumerKeyAccessInsert,
  type ConsumerKeyAccessRow,
  type TargetType,
} from '../schema.js';

export interface ConsumerKeyWithAccess extends ConsumerKeyRow {
  access: ConsumerKeyAccessRow[];
}

export class ConsumerKeyRepository {
  constructor(private readonly db: Db) {}

  async createConsumerKey(
    data: Omit<ConsumerKeyInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ConsumerKeyRow> {
    const now = new Date();
    const row: ConsumerKeyInsert = {
      id: generateId('consumerKey'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(consumerKeys).values(row);
    return row as ConsumerKeyRow;
  }

  async findById(id: string): Promise<ConsumerKeyRow | undefined> {
    const rows = await this.db.select().from(consumerKeys).where(eq(consumerKeys.id, id)).limit(1);
    return rows[0];
  }

  async findByKeyHash(keyHash: string): Promise<ConsumerKeyRow | undefined> {
    const rows = await this.db
      .select()
      .from(consumerKeys)
      .where(eq(consumerKeys.keyHash, keyHash))
      .limit(1);
    return rows[0];
  }

  async findByIdWithAccess(id: string): Promise<ConsumerKeyWithAccess | undefined> {
    const key = await this.findById(id);
    if (!key) return undefined;
    const access = await this.listAccessByKey(id);
    return { ...key, access };
  }

  async listByApp(appId: string): Promise<ConsumerKeyRow[]> {
    return this.db
      .select()
      .from(consumerKeys)
      .where(eq(consumerKeys.appId, appId))
      .orderBy(consumerKeys.createdAt);
  }

  async updateConsumerKey(
    id: string,
    data: Partial<Omit<ConsumerKeyInsert, 'id' | 'createdAt'>>,
  ): Promise<ConsumerKeyRow | undefined> {
    const now = new Date();
    await this.db
      .update(consumerKeys)
      .set({ ...data, updatedAt: now })
      .where(eq(consumerKeys.id, id));
    return this.findById(id);
  }

  async touchLastUsed(id: string, at = new Date()): Promise<void> {
    await this.db
      .update(consumerKeys)
      .set({ lastUsedAt: at, updatedAt: at })
      .where(eq(consumerKeys.id, id));
  }

  async deleteConsumerKey(id: string): Promise<void> {
    await this.db.delete(consumerKeys).where(eq(consumerKeys.id, id));
  }

  // --- Access control ---

  async listAccessByKey(consumerKeyId: string): Promise<ConsumerKeyAccessRow[]> {
    return this.db
      .select()
      .from(consumerKeyAccess)
      .where(eq(consumerKeyAccess.consumerKeyId, consumerKeyId));
  }

  async addAccess(
    consumerKeyId: string,
    targetType: TargetType,
    targetId: string,
  ): Promise<ConsumerKeyAccessRow> {
    const row: ConsumerKeyAccessInsert = {
      id: generateId('consumerKeyAccess'),
      consumerKeyId,
      targetType,
      targetId,
      createdAt: new Date(),
    };
    await this.db.insert(consumerKeyAccess).values(row);
    return row as ConsumerKeyAccessRow;
  }

  async replaceAccess(
    consumerKeyId: string,
    targets: Array<{ targetType: TargetType; targetId: string }>,
  ): Promise<ConsumerKeyAccessRow[]> {
    await this.db
      .delete(consumerKeyAccess)
      .where(eq(consumerKeyAccess.consumerKeyId, consumerKeyId));
    const now = new Date();
    const rows: ConsumerKeyAccessInsert[] = targets.map((t) => ({
      id: generateId('consumerKeyAccess'),
      consumerKeyId,
      targetType: t.targetType,
      targetId: t.targetId,
      createdAt: now,
    }));
    if (rows.length > 0) {
      await this.db.insert(consumerKeyAccess).values(rows);
    }
    return rows as ConsumerKeyAccessRow[];
  }

  async removeAccess(
    consumerKeyId: string,
    targetType: TargetType,
    targetId: string,
  ): Promise<void> {
    await this.db
      .delete(consumerKeyAccess)
      .where(
        and(
          eq(consumerKeyAccess.consumerKeyId, consumerKeyId),
          eq(consumerKeyAccess.targetType, targetType),
          eq(consumerKeyAccess.targetId, targetId),
        ),
      );
  }

  async deleteAccessByTarget(targetType: TargetType, targetId: string): Promise<void> {
    await this.db
      .delete(consumerKeyAccess)
      .where(
        and(eq(consumerKeyAccess.targetType, targetType), eq(consumerKeyAccess.targetId, targetId)),
      );
  }

  async deleteAccessByConsumerKey(consumerKeyId: string): Promise<void> {
    await this.db
      .delete(consumerKeyAccess)
      .where(eq(consumerKeyAccess.consumerKeyId, consumerKeyId));
  }
}
