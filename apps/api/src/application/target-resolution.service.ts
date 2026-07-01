import { TargetRepository } from '../infrastructure/db/repositories/target.repository.js';
import { ModelRepository } from '../infrastructure/db/repositories/model.repository.js';
import { ChannelRepository } from '../infrastructure/db/repositories/channel.repository.js';
import { TargetNotFoundError } from '@manageyourllm/shared';
import type { Db } from '../infrastructure/db/client.js';
import type { TargetType } from '../infrastructure/db/schema.js';

export interface ResolvedModel {
  type: 'model';
  id: string;
  name: string;
  entity: Awaited<ReturnType<ModelRepository['findById']>>;
}

export interface ResolvedChannel {
  type: 'channel';
  id: string;
  name: string;
  entity: Awaited<ReturnType<ChannelRepository['findById']>>;
}

export type ResolvedTarget = ResolvedModel | ResolvedChannel;

export class TargetResolutionService {
  constructor(private readonly db: Db) {}

  private targetRepo(): TargetRepository {
    return new TargetRepository(this.db);
  }

  private modelRepo(): ModelRepository {
    return new ModelRepository(this.db);
  }

  private channelRepo(): ChannelRepository {
    return new ChannelRepository(this.db);
  }

  async resolve(requestedModel: string): Promise<ResolvedTarget> {
    const target = await this.targetRepo().findByName(requestedModel);
    if (!target) {
      throw new TargetNotFoundError(`目标模型 "${requestedModel}" 不存在`);
    }

    if (target.targetType === 'model') {
      const entity = await this.modelRepo().findById(target.targetId);
      if (!entity) {
        throw new TargetNotFoundError(`目标模型 "${requestedModel}" 已失效`);
      }
      return {
        type: 'model',
        id: entity.id,
        name: entity.name,
        entity,
      };
    }

    const entity = await this.channelRepo().findById(target.targetId);
    if (!entity) {
      throw new TargetNotFoundError(`目标频道 "${requestedModel}" 已失效`);
    }
    return {
      type: 'channel',
      id: entity.id,
      name: entity.name,
      entity,
    };
  }

  async resolveByType(targetType: TargetType, targetId: string): Promise<ResolvedTarget> {
    if (targetType === 'model') {
      const entity = await this.modelRepo().findById(targetId);
      if (!entity) {
        throw new TargetNotFoundError('目标模型不存在');
      }
      return { type: 'model', id: entity.id, name: entity.name, entity };
    }

    const entity = await this.channelRepo().findById(targetId);
    if (!entity) {
      throw new TargetNotFoundError('目标频道不存在');
    }
    return { type: 'channel', id: entity.id, name: entity.name, entity };
  }
}
