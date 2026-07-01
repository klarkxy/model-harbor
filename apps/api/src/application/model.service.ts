import { eq, and } from 'drizzle-orm';
import type { Db } from '../infrastructure/db/client.js';
import { ModelRepository } from '../infrastructure/db/repositories/model.repository.js';
import { TargetRepository } from '../infrastructure/db/repositories/target.repository.js';
import { EndpointRepository } from '../infrastructure/db/repositories/endpoint.repository.js';
import { withTransaction } from '../infrastructure/db/unit-of-work.js';
import {
  targetNames,
  type ModelInsert,
  type ModelCandidateInsert,
  type ModelRow,
  type ModelCandidateRow,
  type TargetType,
} from '../infrastructure/db/schema.js';

export interface CreateModelInput {
  name: string;
  displayName?: string;
  description?: string;
  enabled?: boolean;
  candidates?: Array<Omit<ModelCandidateInsert, 'id' | 'modelId' | 'createdAt' | 'updatedAt'>>;
}

export interface ReorderCandidateInput {
  candidateId: string;
  priority: number;
}

export interface AddCandidateInput {
  providerAccountId: string;
  endpointId: string;
  realModelName: string;
  priority?: number;
  enabled?: boolean;
  endpointUrl?: string | null;
}

export interface UpdateCandidateInput {
  realModelName?: string;
  priority?: number;
  enabled?: boolean;
  endpointUrl?: string | null;
}

export class ModelService {
  constructor(private readonly db: Db) {}

  private modelRepo(): ModelRepository {
    return new ModelRepository(this.db);
  }

  private targetRepo(): TargetRepository {
    return new TargetRepository(this.db);
  }

  private endpointRepo(): EndpointRepository {
    return new EndpointRepository(this.db);
  }

  async listModels(): Promise<ModelRow[]> {
    return this.modelRepo().listModels();
  }

  async getModel(id: string): Promise<Awaited<ReturnType<ModelRepository['findWithCandidates']>>> {
    return this.modelRepo().findWithCandidates(id);
  }

  async createModel(input: CreateModelInput): Promise<ModelRow> {
    const normalizedName = input.name.trim().toLowerCase();
    await this.assertNameAvailable(normalizedName);

    const targetType: TargetType = 'model';
    return withTransaction(this.db, async (tx) => {
      const model = await new ModelRepository(tx).createModel({
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
          await this.validateCandidateEndpoint(
            tx as unknown as Db,
            candidate.providerAccountId,
            candidate.endpointId,
          );
          await new ModelRepository(tx).createCandidate({
            modelId: model.id,
            providerAccountId: candidate.providerAccountId,
            endpointId: candidate.endpointId,
            realModelName: candidate.realModelName,
            priority: candidate.priority ?? 100,
            enabled: candidate.enabled ?? true,
            endpointUrl: candidate.endpointUrl ?? null,
          });
        }
      }
      return model;
    });
  }

  async updateModel(
    id: string,
    input: Partial<Omit<ModelInsert, 'id' | 'createdAt'>>,
  ): Promise<ModelRow | undefined> {
    const existing = await this.modelRepo().findById(id);
    if (!existing) return undefined;

    const newName = input.name?.trim().toLowerCase();
    if (newName && newName !== existing.name) {
      await this.assertNameAvailable(newName, id);
    }

    return withTransaction(this.db, async (tx) => {
      const updated = await new ModelRepository(tx).updateModel(id, {
        ...input,
        name: newName ?? existing.name,
      });
      if (newName && newName !== existing.name) {
        await tx
          .update(targetNames)
          .set({ name: newName })
          .where(and(eq(targetNames.targetType, 'model'), eq(targetNames.targetId, id)));
      }
      return updated;
    });
  }

  async deleteModel(id: string): Promise<void> {
    await this.modelRepo().deleteModel(id);
  }

  async reorderCandidates(id: string, items: ReorderCandidateInput[]): Promise<void> {
    // 简单校验所有 candidate 都属于该 model，避免误改其他模型。
    const model = await this.modelRepo().findById(id);
    if (!model) throw new Error(`模型 ${id} 不存在`);

    const candidates = await this.modelRepo().listCandidates(id);
    const candidateIds = new Set(candidates.map((c) => c.id));
    for (const item of items) {
      if (!candidateIds.has(item.candidateId)) {
        throw new Error(`候选 ${item.candidateId} 不属于模型 ${id}`);
      }
      await this.modelRepo().updateCandidate(item.candidateId, { priority: item.priority });
    }
  }

  // --- 独立 candidate CRUD（v1 收口：1 candidate = 1 endpoint） ---

  async addCandidate(modelId: string, input: AddCandidateInput): Promise<ModelCandidateRow> {
    const model = await this.modelRepo().findById(modelId);
    if (!model) throw new Error(`模型 ${modelId} 不存在`);
    await this.validateCandidateEndpoint(this.db, input.providerAccountId, input.endpointId);
    return withTransaction(this.db, async (tx) => {
      const repo = new ModelRepository(tx);
      return repo.createCandidate({
        modelId,
        providerAccountId: input.providerAccountId,
        endpointId: input.endpointId,
        realModelName: input.realModelName,
        priority: input.priority ?? 100,
        enabled: input.enabled ?? true,
        endpointUrl: input.endpointUrl ?? null,
      });
    });
  }

  async updateCandidate(
    candidateId: string,
    input: UpdateCandidateInput,
  ): Promise<ModelCandidateRow | undefined> {
    const existing = await this.modelRepo().findCandidateById(candidateId);
    if (!existing) throw new Error(`候选 ${candidateId} 不存在`);
    return withTransaction(this.db, async (tx) => {
      const repo = new ModelRepository(tx);
      return repo.updateCandidate(candidateId, {
        realModelName: input.realModelName,
        priority: input.priority,
        enabled: input.enabled,
        endpointUrl: input.endpointUrl,
      });
    });
  }

  async deleteCandidate(candidateId: string): Promise<void> {
    const existing = await this.modelRepo().findCandidateById(candidateId);
    if (!existing) throw new Error(`候选 ${candidateId} 不存在`);
    await this.modelRepo().deleteCandidate(candidateId);
  }

  async setCandidateEnabled(
    candidateId: string,
    enabled: boolean,
  ): Promise<ModelCandidateRow | undefined> {
    return this.updateCandidate(candidateId, { enabled });
  }

  /**
   * 校验 candidate 指定的 endpointId 必须存在且属于该 providerAccountId。
   * 防止 UI / API 误传跨 account 的 endpoint。
   */
  private async validateCandidateEndpoint(
    db: Db,
    providerAccountId: string,
    endpointId: string,
  ): Promise<void> {
    const ep = await this.endpointRepo().findById(endpointId);
    if (!ep) {
      throw new Error(`endpoint ${endpointId} 不存在`);
    }
    if (ep.providerAccountId !== providerAccountId) {
      throw new Error(`endpoint ${endpointId} 不属于 provider_account ${providerAccountId}`);
    }
  }

  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const target = await this.targetRepo().findByName(name);
    if (target) {
      if (excludeId && target.targetId === excludeId && target.targetType === 'model') {
        return;
      }
      throw new Error(`目标名称 "${name}" 已被占用`);
    }
  }
}
