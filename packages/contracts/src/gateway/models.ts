import { z } from 'zod';
import { successEnvelope } from '../envelope.js';

// /v1/models 的占位契约。Phase 0 只定义形状，后续阶段再接入真实模型列表服务。

export const modelObjectSchema = z.object({
  id: z.string(),
  object: z.literal('model').default('model'),
  created: z.number().int().optional(),
  owned_by: z.string().optional(),
});

export const modelListRequestSchema = z.object({}).optional();

export const modelListResponseSchema = successEnvelope(
  z.object({
    object: z.literal('list').default('list'),
    data: z.array(modelObjectSchema),
  }),
);

export type ModelObject = z.infer<typeof modelObjectSchema>;
export type ModelListRequest = z.infer<typeof modelListRequestSchema>;
export type ModelListResponse = z.infer<typeof modelListResponseSchema>;
