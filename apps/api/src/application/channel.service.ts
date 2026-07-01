import type { Db } from '../infrastructure/db/client.js';
import {
  ChannelRepository,
  type ChannelMemberInput,
} from '../infrastructure/db/repositories/channel.repository.js';
import { ModelRepository } from '../infrastructure/db/repositories/model.repository.js';
import { TargetRepository } from '../infrastructure/db/repositories/target.repository.js';
import { withTransaction } from '../infrastructure/db/unit-of-work.js';
import {
  type ChannelInsert,
  type ChannelRow,
  type TargetType,
} from '../infrastructure/db/schema.js';

export interface CreateChannelInput {
  name: string;
  displayName?: string;
  description?: string;
  enabled?: boolean;
  members?: ChannelMemberInput[];
}

export class ChannelService {
  constructor(private readonly db: Db) {}

  private channelRepo(): ChannelRepository {
    return new ChannelRepository(this.db);
  }

  private targetRepo(): TargetRepository {
    return new TargetRepository(this.db);
  }

  async listChannels(): Promise<ChannelRow[]> {
    return this.channelRepo().listChannels();
  }

  async getChannel(id: string): Promise<Awaited<ReturnType<ChannelRepository['findWithMembers']>>> {
    return this.channelRepo().findWithMembers(id);
  }

  async createChannel(input: CreateChannelInput): Promise<ChannelRow> {
    const normalizedName = input.name.trim().toLowerCase();
    await this.assertNameAvailable(normalizedName);
    await this.validateMembers(input.members ?? []);

    const targetType: TargetType = 'channel';
    return withTransaction(this.db, async (tx) => {
      const channel = await new ChannelRepository(tx).createChannel({
        name: normalizedName,
        displayName: input.displayName,
        description: input.description,
        enabled: input.enabled ?? true,
      });
      await new TargetRepository(tx).createTargetName({
        name: normalizedName,
        targetType,
        targetId: channel.id,
      });
      if (input.members && input.members.length > 0) {
        await new ChannelRepository(tx).replaceMembers(
          channel.id,
          input.members.map((m) => ({
            modelId: m.modelId,
            enabled: m.enabled,
            priority: m.priority,
          })),
        );
      }
      return channel;
    });
  }

  async updateChannel(
    id: string,
    input: Partial<Omit<ChannelInsert, 'id' | 'createdAt'>> & {
      members?: ChannelMemberInput[];
    },
  ): Promise<ChannelRow | undefined> {
    const existing = await this.channelRepo().findById(id);
    if (!existing) return undefined;

    const newName = input.name?.trim().toLowerCase();
    if (newName && newName !== existing.name) {
      await this.assertNameAvailable(newName, id);
    }
    if (input.members) {
      await this.validateMembers(input.members);
    }

    return withTransaction(this.db, async (tx) => {
      const updated = await new ChannelRepository(tx).updateChannel(id, input);
      if (newName && newName !== existing.name) {
        await new TargetRepository(tx).deleteTargetName(existing.name);
        await new TargetRepository(tx).createTargetName({
          name: newName,
          targetType: 'channel',
          targetId: id,
        });
      }
      if (input.members) {
        await new ChannelRepository(tx).replaceMembers(id, input.members);
      }
      return updated;
    });
  }

  async deleteChannel(id: string): Promise<void> {
    await this.channelRepo().deleteChannel(id);
  }

  async replaceMembers(id: string, members: ChannelMemberInput[]): Promise<void> {
    const existing = await this.channelRepo().findById(id);
    if (!existing) throw new Error(`频道 ${id} 不存在`);
    await this.validateMembers(members);
    await this.channelRepo().replaceMembers(id, members);
  }

  private async validateMembers(members: ChannelMemberInput[]): Promise<void> {
    const modelRepo = new ModelRepository(this.db);
    for (const member of members) {
      const model = await modelRepo.findById(member.modelId);
      if (!model) {
        throw new Error(`频道成员必须是 Model，未找到 ${member.modelId}`);
      }
    }
  }

  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const target = await this.targetRepo().findByName(name);
    if (target) {
      if (excludeId && target.targetId === excludeId && target.targetType === 'channel') {
        return;
      }
      throw new Error(`目标名称 "${name}" 已被占用`);
    }
  }
}
