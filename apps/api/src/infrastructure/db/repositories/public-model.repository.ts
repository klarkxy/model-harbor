import { eq, and } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  publicModels,
  publicModelCandidates,
  targetNames,
  type PublicModelInsert,
  type PublicModelRow,
  type PublicModelCandidateInsert,
  type PublicModelCandidateRow,
  type TargetType,
} from '../schema.js';
import { withTransaction } from '../unit-of-work.js';

export interface PublicModelWithCandidates extends PublicModelRow {
  candidates: PublicModelCandidateRow[];
}

export class PublicModelRepository {
  constructor(private readonly db: Db) {}

  async createPublicModel(
    data: Omit<PublicModelInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PublicModelRow> {
    const now = new Date();
    const row: PublicModelInsert = {
      id: generateId('publicModel'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(publicModels).values(row);
    return row as PublicModelRow;
  }

  async findById(id: string): Promise<PublicModelRow | undefined> {
    const rows = await this.db.select().from(publicModels).where(eq(publicModels.id, id)).limit(1);
    return rows[0];
  }

  async findByName(name: string): Promise<PublicModelRow | undefined> {
    const rows = await this.db
      .select()
      .from(publicModels)
      .where(eq(publicModels.name, name))
      .limit(1);
    return rows[0];
  }

  async listPublicModels(): Promise<PublicModelRow[]> {
    return this.db.select().from(publicModels).orderBy(publicModels.name);
  }

  async updatePublicModel(
    id: string,
    data: Partial<Omit<PublicModelInsert, 'id' | 'createdAt'>>,
  ): Promise<PublicModelRow | undefined> {
    const now = new Date();
    await this.db
      .update(publicModels)
      .set({ ...data, updatedAt: now })
      .where(eq(publicModels.id, id));
    return this.findById(id);
  }

  async deletePublicModel(id: string): Promise<void> {
    const targetType: TargetType = 'public_model';
    await withTransaction(this.db, async (tx) => {
      await tx.delete(publicModelCandidates).where(eq(publicModelCandidates.publicModelId, id));
      await tx
        .delete(targetNames)
        .where(and(eq(targetNames.targetType, targetType), eq(targetNames.targetId, id)));
      await tx.delete(publicModels).where(eq(publicModels.id, id));
    });
  }

  // --- Candidates ---

  async createCandidate(
    data: Omit<PublicModelCandidateInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PublicModelCandidateRow> {
    const now = new Date();
    const row: PublicModelCandidateInsert = {
      id: generateId('publicModelCandidate'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(publicModelCandidates).values(row);
    return row as PublicModelCandidateRow;
  }

  async listCandidates(publicModelId: string): Promise<PublicModelCandidateRow[]> {
    return this.db
      .select()
      .from(publicModelCandidates)
      .where(eq(publicModelCandidates.publicModelId, publicModelId))
      .orderBy(publicModelCandidates.priority);
  }

  async updateCandidate(
    id: string,
    data: Partial<Omit<PublicModelCandidateInsert, 'id' | 'createdAt'>>,
  ): Promise<PublicModelCandidateRow | undefined> {
    const now = new Date();
    await this.db
      .update(publicModelCandidates)
      .set({ ...data, updatedAt: now })
      .where(eq(publicModelCandidates.id, id));
    const rows = await this.db
      .select()
      .from(publicModelCandidates)
      .where(eq(publicModelCandidates.id, id))
      .limit(1);
    return rows[0];
  }

  async deleteCandidate(id: string): Promise<void> {
    await this.db.delete(publicModelCandidates).where(eq(publicModelCandidates.id, id));
  }

  async findWithCandidates(id: string): Promise<PublicModelWithCandidates | undefined> {
    const model = await this.findById(id);
    if (!model) return undefined;
    const candidates = await this.listCandidates(id);
    return { ...model, candidates };
  }
}
