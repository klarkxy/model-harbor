import type { Db } from '../../infrastructure/db/client.js';
import {
  ModelGroupRepository,
  type ModelGroupMemberInput,
} from '../../infrastructure/db/repositories/model-group.repository.js';
import { PublicModelRepository } from '../../infrastructure/db/repositories/public-model.repository.js';
import { TargetRepository } from '../../infrastructure/db/repositories/target.repository.js';
import { withTransaction } from '../../infrastructure/db/unit-of-work.js';
import {
  type ModelGroupInsert,
  type ModelGroupRow,
  type TargetType,
} from '../../infrastructure/db/schema.js';

export interface CreateModelGroupInput {
  name: string;
  displayName?: string;
  description?: string;
  enabled?: boolean;
  routingPolicy?: string;
  members?: ModelGroupMemberInput[];
}

export class ModelGroupService {
  constructor(private readonly db: Db) {}

  private modelGroupRepo(): ModelGroupRepository {
    return new ModelGroupRepository(this.db);
  }

  private targetRepo(): TargetRepository {
    return new TargetRepository(this.db);
  }

  async createModelGroup(input: CreateModelGroupInput): Promise<ModelGroupRow> {
    const normalizedName = input.name.trim().toLowerCase();
    await this.assertNameAvailable(normalizedName);
    await this.validateMembers(input.members ?? []);

    const targetType: TargetType = 'model_group';
    return withTransaction(this.db, async (tx) => {
      const group = await new ModelGroupRepository(tx).createModelGroup({
        name: normalizedName,
        displayName: input.displayName,
        description: input.description,
        enabled: input.enabled ?? true,
        routingPolicy: input.routingPolicy ?? 'priority',
      });
      await new TargetRepository(tx).createTargetName({
        name: normalizedName,
        targetType,
        targetId: group.id,
      });
      if (input.members && input.members.length > 0) {
        await new ModelGroupRepository(tx).replaceMembers(
          group.id,
          input.members.map((m) => ({
            publicModelId: m.publicModelId,
            enabled: m.enabled,
            priority: m.priority,
            weight: m.weight,
          })),
        );
      }
      return group;
    });
  }

  async updateModelGroup(
    id: string,
    input: Partial<Omit<ModelGroupInsert, 'id' | 'createdAt'>> & {
      members?: ModelGroupMemberInput[];
    },
  ): Promise<ModelGroupRow | undefined> {
    const existing = await this.modelGroupRepo().findById(id);
    if (!existing) return undefined;

    const newName = input.name?.trim().toLowerCase();
    if (newName && newName !== existing.name) {
      await this.assertNameAvailable(newName, id);
    }
    if (input.members) {
      await this.validateMembers(input.members);
    }

    return withTransaction(this.db, async (tx) => {
      const updated = await new ModelGroupRepository(tx).updateModelGroup(id, input);
      if (newName && newName !== existing.name) {
        await new TargetRepository(tx).deleteTargetName(existing.name);
        await new TargetRepository(tx).createTargetName({
          name: newName,
          targetType: 'model_group',
          targetId: id,
        });
      }
      if (input.members) {
        await new ModelGroupRepository(tx).replaceMembers(id, input.members);
      }
      return updated;
    });
  }

  async deleteModelGroup(id: string): Promise<void> {
    await this.modelGroupRepo().deleteModelGroup(id);
  }

  private async validateMembers(members: ModelGroupMemberInput[]): Promise<void> {
    const publicModelRepo = new PublicModelRepository(this.db);
    for (const member of members) {
      const model = await publicModelRepo.findById(member.publicModelId);
      if (!model) {
        throw new Error(`模型组成员必须是公共模型，未找到 ${member.publicModelId}`);
      }
    }
  }

  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const target = await this.targetRepo().findByName(name);
    if (target) {
      if (excludeId && target.targetId === excludeId && target.targetType === 'model_group') {
        return;
      }
      throw new Error(`目标名称 "${name}" 已被占用`);
    }
  }
}
