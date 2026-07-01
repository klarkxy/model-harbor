import { eq, and } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  channels,
  channelMembers,
  targetNames,
  type ChannelInsert,
  type ChannelRow,
  type ChannelMemberInsert,
  type ChannelMemberRow,
  type TargetType,
} from '../schema.js';
import { withTransaction } from '../unit-of-work.js';

export interface ChannelMemberInput {
  modelId: string;
  enabled?: boolean;
  priority?: number;
}

export interface ChannelWithMembers extends ChannelRow {
  members: ChannelMemberRow[];
}

export class ChannelRepository {
  constructor(private readonly db: Db) {}

  async createChannel(
    data: Omit<ChannelInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ChannelRow> {
    const now = new Date();
    const row: ChannelInsert = {
      id: generateId('channel'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(channels).values(row);
    return row as ChannelRow;
  }

  async findById(id: string): Promise<ChannelRow | undefined> {
    const rows = await this.db.select().from(channels).where(eq(channels.id, id)).limit(1);
    return rows[0];
  }

  async findByName(name: string): Promise<ChannelRow | undefined> {
    const rows = await this.db.select().from(channels).where(eq(channels.name, name)).limit(1);
    return rows[0];
  }

  async listChannels(): Promise<ChannelRow[]> {
    return this.db.select().from(channels).orderBy(channels.name);
  }

  async updateChannel(
    id: string,
    data: Partial<Omit<ChannelInsert, 'id' | 'createdAt'>>,
  ): Promise<ChannelRow | undefined> {
    const now = new Date();
    await this.db
      .update(channels)
      .set({ ...data, updatedAt: now })
      .where(eq(channels.id, id));
    return this.findById(id);
  }

  async deleteChannel(id: string): Promise<void> {
    const targetType: TargetType = 'channel';
    await withTransaction(this.db, async (tx) => {
      await tx.delete(channelMembers).where(eq(channelMembers.channelId, id));
      await tx
        .delete(targetNames)
        .where(and(eq(targetNames.targetType, targetType), eq(targetNames.targetId, id)));
      await tx.delete(channels).where(eq(channels.id, id));
    });
  }

  // --- Members ---

  async createMember(
    data: Omit<ChannelMemberInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ChannelMemberRow> {
    const now = new Date();
    const row: ChannelMemberInsert = {
      id: generateId('channelMember'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(channelMembers).values(row);
    return row as ChannelMemberRow;
  }

  async listMembers(channelId: string): Promise<ChannelMemberRow[]> {
    return this.db
      .select()
      .from(channelMembers)
      .where(eq(channelMembers.channelId, channelId))
      .orderBy(channelMembers.priority);
  }

  async updateMember(
    id: string,
    data: Partial<Omit<ChannelMemberInsert, 'id' | 'createdAt'>>,
  ): Promise<ChannelMemberRow | undefined> {
    const now = new Date();
    await this.db
      .update(channelMembers)
      .set({ ...data, updatedAt: now })
      .where(eq(channelMembers.id, id));
    const rows = await this.db
      .select()
      .from(channelMembers)
      .where(eq(channelMembers.id, id))
      .limit(1);
    return rows[0];
  }

  async deleteMember(id: string): Promise<void> {
    await this.db.delete(channelMembers).where(eq(channelMembers.id, id));
  }

  async replaceMembers(channelId: string, members: ChannelMemberInput[]): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      await tx.delete(channelMembers).where(eq(channelMembers.channelId, channelId));
      const now = new Date();
      const rows: ChannelMemberInsert[] = members.map((m) => ({
        id: generateId('channelMember'),
        channelId,
        modelId: m.modelId,
        enabled: m.enabled ?? true,
        priority: m.priority ?? 100,
        createdAt: now,
        updatedAt: now,
      }));
      if (rows.length > 0) {
        await tx.insert(channelMembers).values(rows);
      }
    });
  }

  async findWithMembers(id: string): Promise<ChannelWithMembers | undefined> {
    const channel = await this.findById(id);
    if (!channel) return undefined;
    const members = await this.listMembers(id);
    return { ...channel, members };
  }
}
