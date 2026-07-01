import { eq, and, count } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  models,
  modelCandidates,
  targetNames,
  type ModelInsert,
  type ModelRow,
  type ModelCandidateInsert,
  type ModelCandidateRow,
  type TargetType,
} from '../schema.js';
import { withTransaction } from '../unit-of-work.js';

export interface ModelWithCandidates extends ModelRow {
  candidates: ModelCandidateRow[];
}

export class ModelRepository {
  constructor(private readonly db: Db) {}

  async createModel(data: Omit<ModelInsert, 'id' | 'createdAt' | 'updatedAt'>): Promise<ModelRow> {
    const now = new Date();
    const row: ModelInsert = {
      id: generateId('model'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(models).values(row);
    return row as ModelRow;
  }

  async findById(id: string): Promise<ModelRow | undefined> {
    const rows = await this.db.select().from(models).where(eq(models.id, id)).limit(1);
    return rows[0];
  }

  async findByName(name: string): Promise<ModelRow | undefined> {
    const rows = await this.db.select().from(models).where(eq(models.name, name)).limit(1);
    return rows[0];
  }

  async listModels(): Promise<ModelRow[]> {
    return this.db.select().from(models).orderBy(models.name);
  }

  async hasModels(): Promise<boolean> {
    const rows = await this.db.select({ count: count() }).from(models);
    return (rows[0]?.count ?? 0) > 0;
  }

  async updateModel(
    id: string,
    data: Partial<Omit<ModelInsert, 'id' | 'createdAt'>>,
  ): Promise<ModelRow | undefined> {
    const now = new Date();
    await this.db
      .update(models)
      .set({ ...data, updatedAt: now })
      .where(eq(models.id, id));
    return this.findById(id);
  }

  async deleteModel(id: string): Promise<void> {
    const targetType: TargetType = 'model';
    await withTransaction(this.db, async (tx) => {
      await tx.delete(modelCandidates).where(eq(modelCandidates.modelId, id));
      await tx
        .delete(targetNames)
        .where(and(eq(targetNames.targetType, targetType), eq(targetNames.targetId, id)));
      await tx.delete(models).where(eq(models.id, id));
    });
  }

  // --- Candidates ---

  async createCandidate(
    data: Omit<ModelCandidateInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ModelCandidateRow> {
    // v1 强约束：candidate 必须绑定 endpoint（1 candidate = 1 endpoint）。
    if (!data.endpointId) {
      throw new Error('createCandidate: endpointId is required');
    }
    const now = new Date();
    const row: ModelCandidateInsert = {
      id: generateId('modelCandidate'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(modelCandidates).values(row);
    return row as ModelCandidateRow;
  }

  async listCandidates(modelId: string): Promise<ModelCandidateRow[]> {
    return this.db
      .select()
      .from(modelCandidates)
      .where(eq(modelCandidates.modelId, modelId))
      .orderBy(modelCandidates.priority, modelCandidates.id);
  }

  async findCandidateById(id: string): Promise<ModelCandidateRow | undefined> {
    const rows = await this.db
      .select()
      .from(modelCandidates)
      .where(eq(modelCandidates.id, id))
      .limit(1);
    return rows[0];
  }

  async updateCandidate(
    id: string,
    data: Partial<Omit<ModelCandidateInsert, 'id' | 'createdAt'>>,
  ): Promise<ModelCandidateRow | undefined> {
    const now = new Date();
    // v1 不允许改 endpointId（candidate endpoint 绑定是 1 candidate = 1 endpoint 的核心约束）。
    // 若业务上要换 endpoint，应该删旧 candidate 重建。
    const safeData: Partial<Omit<ModelCandidateInsert, 'id' | 'createdAt' | 'endpointId'>> = data;
    await this.db
      .update(modelCandidates)
      .set({ ...safeData, updatedAt: now })
      .where(eq(modelCandidates.id, id));
    const rows = await this.db
      .select()
      .from(modelCandidates)
      .where(eq(modelCandidates.id, id))
      .limit(1);
    return rows[0];
  }

  async deleteCandidate(id: string): Promise<void> {
    await this.db.delete(modelCandidates).where(eq(modelCandidates.id, id));
  }

  async findWithCandidates(id: string): Promise<ModelWithCandidates | undefined> {
    const model = await this.findById(id);
    if (!model) return undefined;
    const candidates = await this.listCandidates(id);
    return { ...model, candidates };
  }
}
