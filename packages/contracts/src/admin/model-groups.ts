import { z } from 'zod';
import { successEnvelope, listEnvelope } from '../envelope.js';

export const modelGroupMemberSchema = z.object({
  id: z.string(),
  modelGroupId: z.string(),
  publicModelId: z.string(),
  enabled: z.boolean(),
  priority: z.number(),
  weight: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const modelGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const modelGroupWithMembersSchema = modelGroupSchema.extend({
  members: z.array(modelGroupMemberSchema),
});

export const createModelGroupRequestSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  displayName: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  members: z
    .array(
      z.object({
        publicModelId: z.string(),
        enabled: z.boolean().default(true),
        priority: z.number().int().min(0).default(100),
        weight: z.number().int().min(1).default(1),
      }),
    )
    .optional(),
});

export const updateModelGroupRequestSchema = createModelGroupRequestSchema.partial();

export const replaceMembersRequestSchema = z.object({
  members: z
    .array(
      z.object({
        publicModelId: z.string(),
        enabled: z.boolean().default(true),
        priority: z.number().int().min(0).default(100),
        weight: z.number().int().min(1).default(1),
      }),
    )
    .min(1, '至少提供一个成员'),
});

export const listModelGroupsResponseSchema = listEnvelope(modelGroupSchema);
export const modelGroupResponseSchema = successEnvelope(modelGroupWithMembersSchema);

export type ModelGroupContract = z.infer<typeof modelGroupSchema>;
export type ModelGroupMemberContract = z.infer<typeof modelGroupMemberSchema>;
export type CreateModelGroupRequest = z.infer<typeof createModelGroupRequestSchema>;
export type UpdateModelGroupRequest = z.infer<typeof updateModelGroupRequestSchema>;
export type ReplaceMembersRequest = z.infer<typeof replaceMembersRequestSchema>;
