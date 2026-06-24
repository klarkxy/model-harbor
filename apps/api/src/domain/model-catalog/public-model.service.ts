import { eq, and } from 'drizzle-orm';
import type { Db } from '../../infrastructure/db/client.js';
import { PublicModelRepository } from '../../infrastructure/db/repositories/public-model.repository.js';
import { TargetRepository } from '../../infrastructure/db/repositories/target.repository.js';
import { withTransaction } from '../../infrastructure/db/unit-of-work.js';
import {
  targetNames,
  type PublicModelInsert,
  type PublicModelCandidateInsert,
  type PublicModelRow,
  type TargetType,
} from '../../infrastructure/db/schema.js';

export interface CreatePublicModelInput {
  name: string;
  displayName?: string;
  description?: string;
  enabled?: boolean;
  candidates?: Array<
    Omit<PublicModelCandidateInsert, 'id' | 'publicModelId' | 'createdAt' | 'updatedAt'>
  >;
}

export class PublicModelService {
  constructor(private readonly db: Db) {}

  private publicModelRepo(): PublicModelRepository {
    return new PublicModelRepository(this.db);
  }

  private targetRepo(): TargetRepository {
    return new TargetRepository(this.db);
  }

  async createPublicModel(input: CreatePublicModelInput): Promise<PublicModelRow> {
    const normalizedName = input.name.trim().toLowerCase();
    await this.assertNameAvailable(normalizedName);

    const targetType: TargetType = 'public_model';
    return withTransaction(this.db, async (tx) => {
      const model = await new PublicModelRepository(tx).createPublicModel({
        name: normalizedName,
        displayName: input.displayName,
        description: input.description,
        enabled: input.enabled ?? true,
      });
      await new TargetRepository(tx).createTargetName({
        name: normalizedName,
        targetType,
        targetId: model.id,
      });
      if (input.candidates && input.candidates.length > 0) {
        for (const candidate of input.candidates) {
          await new PublicModelRepository(tx).createCandidate({
            publicModelId: model.id,
            ...candidate,
          });
        }
      }
      return model;
    });
  }

  async updatePublicModel(
    id: string,
    input: Partial<Omit<PublicModelInsert, 'id' | 'createdAt'>>,
  ): Promise<PublicModelRow | undefined> {
    const existing = await this.publicModelRepo().findById(id);
    if (!existing) return undefined;

    const newName = input.name?.trim().toLowerCase();
    if (newName && newName !== existing.name) {
      await this.assertNameAvailable(newName, id);
    }

    return withTransaction(this.db, async (tx) => {
      const updated = await new PublicModelRepository(tx).updatePublicModel(id, {
        ...input,
        name: newName ?? existing.name,
      });
      if (newName && newName !== existing.name) {
        await tx
          .update(targetNames)
          .set({ name: newName })
          .where(and(eq(targetNames.targetType, 'public_model'), eq(targetNames.targetId, id)));
      }
      return updated;
    });
  }

  async deletePublicModel(id: string): Promise<void> {
    await this.publicModelRepo().deletePublicModel(id);
  }

  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const target = await this.targetRepo().findByName(name);
    if (target) {
      if (excludeId && target.targetId === excludeId && target.targetType === 'public_model') {
        return;
      }
      throw new Error(`目标名称 "${name}" 已被占用`);
    }
  }
}
