import { eq, and } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  targetNames,
  type TargetNameInsert,
  type TargetNameRow,
  type TargetType,
} from '../schema.js';

export class TargetRepository {
  constructor(private readonly db: Db) {}

  async createTargetName(data: Omit<TargetNameInsert, 'createdAt'>): Promise<TargetNameRow> {
    const row: TargetNameInsert = {
      ...data,
      name: data.name.trim().toLowerCase(),
      createdAt: new Date(),
    };
    await this.db.insert(targetNames).values(row);
    return row as TargetNameRow;
  }

  async findByName(name: string): Promise<TargetNameRow | undefined> {
    const normalized = name.trim().toLowerCase();
    const rows = await this.db
      .select()
      .from(targetNames)
      .where(eq(targetNames.name, normalized))
      .limit(1);
    return rows[0];
  }

  async findByTarget(targetType: TargetType, targetId: string): Promise<TargetNameRow | undefined> {
    const rows = await this.db
      .select()
      .from(targetNames)
      .where(and(eq(targetNames.targetType, targetType), eq(targetNames.targetId, targetId)))
      .limit(1);
    return rows[0];
  }

  async listTargetNames(): Promise<TargetNameRow[]> {
    return this.db.select().from(targetNames).orderBy(targetNames.name);
  }

  async deleteTargetName(name: string): Promise<void> {
    const normalized = name.trim().toLowerCase();
    await this.db.delete(targetNames).where(eq(targetNames.name, normalized));
  }

  async deleteByTarget(targetType: TargetType, targetId: string): Promise<void> {
    await this.db
      .delete(targetNames)
      .where(and(eq(targetNames.targetType, targetType), eq(targetNames.targetId, targetId)));
  }
}
