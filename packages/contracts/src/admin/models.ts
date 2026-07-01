import { z } from 'zod';
import { successEnvelope, listEnvelope } from '../envelope.js';

// v1 收口：1 candidate = 1 endpoint。candidate 必须带 endpointId。
export const modelCandidateSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  providerAccountId: z.string(),
  endpointId: z.string(),
  realModelName: z.string(),
  priority: z.number(),
  enabled: z.boolean(),
  endpointUrl: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const modelWithCandidatesSchema = modelSchema.extend({
  candidates: z.array(modelCandidateSchema),
});

export const createModelRequestSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  displayName: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  candidates: z
    .array(
      z.object({
        providerAccountId: z.string(),
        endpointId: z.string(),
        realModelName: z.string().min(1),
        priority: z.number().int().min(0).default(100),
        enabled: z.boolean().default(true),
        endpointUrl: z.string().optional(),
      }),
    )
    .optional(),
});

export const updateModelRequestSchema = createModelRequestSchema.partial();

// --- 独立 candidate CRUD contracts（v1 收口：逐 candidate 管理） ---

export const addCandidateRequestSchema = z.object({
  providerAccountId: z.string(),
  endpointId: z.string(),
  realModelName: z.string().min(1),
  priority: z.number().int().min(0).default(100),
  enabled: z.boolean().default(true),
  endpointUrl: z.string().optional(),
});

export const updateCandidateRequestSchema = z.object({
  realModelName: z.string().min(1).optional(),
  priority: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
  endpointUrl: z.string().nullable().optional(),
});

export const setCandidateEnabledRequestSchema = z.object({
  enabled: z.boolean(),
});

export const reorderCandidatesRequestSchema = z
  .array(
    z.object({
      candidateId: z.string(),
      priority: z.number().int().min(0),
    }),
  )
  .min(1, '至少提供一个 candidate 排序项');

export const listModelsResponseSchema = listEnvelope(modelSchema);
export const modelResponseSchema = successEnvelope(modelWithCandidatesSchema);
export const candidateResponseSchema = successEnvelope(modelCandidateSchema);
export const deleteCandidateResponseSchema = successEnvelope(z.object({ id: z.string() }));

export type ModelContract = z.infer<typeof modelSchema>;
export type ModelCandidateContract = z.infer<typeof modelCandidateSchema>;
export type CreateModelRequest = z.infer<typeof createModelRequestSchema>;
export type UpdateModelRequest = z.infer<typeof updateModelRequestSchema>;
export type AddCandidateRequest = z.infer<typeof addCandidateRequestSchema>;
export type UpdateCandidateRequest = z.infer<typeof updateCandidateRequestSchema>;
export type SetCandidateEnabledRequest = z.infer<typeof setCandidateEnabledRequestSchema>;
