import { eq, and } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  modelGroups,
  modelGroupMembers,
  targetNames,
  type ModelGroupInsert,
  type ModelGroupRow,
  type ModelGroupMemberInsert,
  type ModelGroupMemberRow,
  type TargetType,
} from '../schema.js';
import { withTransaction } from '../unit-of-work.js';

export interface ModelGroupMemberInput {
  publicModelId: string;
  enabled?: boolean;
  priority?: number;
  weight?: number;
}

export interface ModelGroupWithMembers extends ModelGroupRow {
  members: ModelGroupMemberRow[];
}

export class ModelGroupRepository {
  constructor(private readonly db: Db) {}

  async createModelGroup(
    data: Omit<ModelGroupInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ModelGroupRow> {
    const now = new Date();
    const row: ModelGroupInsert = {
      id: generateId('modelGroup'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(modelGroups).values(row);
    return row as ModelGroupRow;
  }

  async findById(id: string): Promise<ModelGroupRow | undefined> {
    const rows = await this.db.select().from(modelGroups).where(eq(modelGroups.id, id)).limit(1);
    return rows[0];
  }

  async findByName(name: string): Promise<ModelGroupRow | undefined> {
    const rows = await this.db
      .select()
      .from(modelGroups)
      .where(eq(modelGroups.name, name))
      .limit(1);
    return rows[0];
  }

  async listModelGroups(): Promise<ModelGroupRow[]> {
    return this.db.select().from(modelGroups).orderBy(modelGroups.name);
  }

  async updateModelGroup(
    id: string,
    data: Partial<Omit<ModelGroupInsert, 'id' | 'createdAt'>>,
  ): Promise<ModelGroupRow | undefined> {
    const now = new Date();
    await this.db
      .update(modelGroups)
      .set({ ...data, updatedAt: now })
      .where(eq(modelGroups.id, id));
    return this.findById(id);
  }

  async deleteModelGroup(id: string): Promise<void> {
    const targetType: TargetType = 'model_group';
    await withTransaction(this.db, async (tx) => {
      await tx.delete(modelGroupMembers).where(eq(modelGroupMembers.modelGroupId, id));
      await tx
        .delete(targetNames)
        .where(and(eq(targetNames.targetType, targetType), eq(targetNames.targetId, id)));
      await tx.delete(modelGroups).where(eq(modelGroups.id, id));
    });
  }

  // --- Members ---

  async createMember(
    data: Omit<ModelGroupMemberInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ModelGroupMemberRow> {
    const now = new Date();
    const row: ModelGroupMemberInsert = {
      id: generateId('modelGroupMember'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(modelGroupMembers).values(row);
    return row as ModelGroupMemberRow;
  }

  async listMembers(modelGroupId: string): Promise<ModelGroupMemberRow[]> {
    return this.db
      .select()
      .from(modelGroupMembers)
      .where(eq(modelGroupMembers.modelGroupId, modelGroupId))
      .orderBy(modelGroupMembers.priority);
  }

  async updateMember(
    id: string,
    data: Partial<Omit<ModelGroupMemberInsert, 'id' | 'createdAt'>>,
  ): Promise<ModelGroupMemberRow | undefined> {
    const now = new Date();
    await this.db
      .update(modelGroupMembers)
      .set({ ...data, updatedAt: now })
      .where(eq(modelGroupMembers.id, id));
    const rows = await this.db
      .select()
      .from(modelGroupMembers)
      .where(eq(modelGroupMembers.id, id))
      .limit(1);
    return rows[0];
  }

  async deleteMember(id: string): Promise<void> {
    await this.db.delete(modelGroupMembers).where(eq(modelGroupMembers.id, id));
  }

  async replaceMembers(modelGroupId: string, members: ModelGroupMemberInput[]): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      await tx.delete(modelGroupMembers).where(eq(modelGroupMembers.modelGroupId, modelGroupId));
      const now = new Date();
      const rows: ModelGroupMemberInsert[] = members.map((m) => ({
        id: generateId('modelGroupMember'),
        modelGroupId,
        publicModelId: m.publicModelId,
        enabled: m.enabled ?? true,
        priority: m.priority ?? 100,
        weight: m.weight ?? 1,
        createdAt: now,
        updatedAt: now,
      }));
      if (rows.length > 0) {
        await tx.insert(modelGroupMembers).values(rows);
      }
    });
  }

  async findWithMembers(id: string): Promise<ModelGroupWithMembers | undefined> {
    const group = await this.findById(id);
    if (!group) return undefined;
    const members = await this.listMembers(id);
    return { ...group, members };
  }
}
