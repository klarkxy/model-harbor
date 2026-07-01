import { z } from 'zod';
import { successEnvelope, listEnvelope } from '../envelope.js';

export const channelMemberSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  modelId: z.string(),
  enabled: z.boolean(),
  priority: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const channelSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const channelWithMembersSchema = channelSchema.extend({
  members: z.array(channelMemberSchema),
});

export const createChannelRequestSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  displayName: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  members: z
    .array(
      z.object({
        modelId: z.string(),
        enabled: z.boolean().default(true),
        priority: z.number().int().min(0).default(100),
      }),
    )
    .optional(),
});

export const updateChannelRequestSchema = createChannelRequestSchema.partial();

export const replaceChannelMembersRequestSchema = z.object({
  members: z
    .array(
      z.object({
        modelId: z.string(),
        enabled: z.boolean().default(true),
        priority: z.number().int().min(0).default(100),
      }),
    )
    .min(1, '至少提供一个成员'),
});

export const listChannelsResponseSchema = listEnvelope(channelSchema);
export const channelResponseSchema = successEnvelope(channelWithMembersSchema);

export type ChannelContract = z.infer<typeof channelSchema>;
export type ChannelMemberContract = z.infer<typeof channelMemberSchema>;
export type CreateChannelRequest = z.infer<typeof createChannelRequestSchema>;
export type UpdateChannelRequest = z.infer<typeof updateChannelRequestSchema>;
export type ReplaceChannelMembersRequest = z.infer<typeof replaceChannelMembersRequestSchema>;
