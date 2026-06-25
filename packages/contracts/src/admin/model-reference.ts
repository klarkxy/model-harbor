import { z } from 'zod';
import { successEnvelope, listEnvelope } from '../envelope.js';

export const modelReferenceEntrySchema = z.object({
  id: z.string(),
  region: z.string(),
  source: z.string(),
  normalizedModelName: z.string(),
  sourceModelId: z.string(),
  displayName: z.string(),
  provider: z.string().nullable(),
  scoresJson: z.record(z.number()),
  priceJson: z.record(z.unknown()),
  contextWindow: z.number().nullable(),
  latencyMs: z.number().nullable(),
  speedScore: z.number().nullable(),
  sourceUrl: z.string().nullable(),
  rawJson: z.record(z.unknown()).nullable(),
  fetchedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const modelReferenceSyncStatusSchema = z.object({
  id: z.string(),
  region: z.string(),
  source: z.string(),
  status: z.string(),
  lastRefreshAt: z.string().datetime().nullable(),
  nextRefreshAfter: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  ttlMs: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const listModelReferenceResponseSchema = listEnvelope(modelReferenceEntrySchema);
export const modelReferenceSyncStatusResponseSchema = successEnvelope(
  modelReferenceSyncStatusSchema.nullable(),
);

export const refreshModelReferenceRequestSchema = z.object({
  region: z.string().optional(),
  source: z.string().optional(),
  force: z.boolean().optional(),
});

export const refreshModelReferenceResponseSchema = successEnvelope(
  z.object({ success: z.boolean(), error: z.string().nullable().optional() }),
);

export const recommendModelReferenceRequestSchema = z.object({
  entryIds: z.array(z.string()).min(1),
  upstreamKeyId: z.string().optional(),
  createGroup: z.boolean().optional(),
  groupName: z.string().optional(),
});

export const recommendModelReferenceResponseSchema = successEnvelope(
  z.object({
    publicModels: z.array(
      z.object({
        name: z.string(),
        displayName: z.string(),
        description: z.string(),
        candidates: z.array(
          z.object({
            upstreamKeyId: z.string(),
            realModelName: z.string(),
            priority: z.number(),
            weight: z.number(),
            enabled: z.boolean(),
          }),
        ),
        nameConflict: z.boolean(),
      }),
    ),
    modelGroup: z
      .object({
        name: z.string(),
        displayName: z.string(),
        description: z.string(),
        members: z.array(
          z.object({
            publicModelName: z.string(),
            priority: z.number(),
            weight: z.number(),
            enabled: z.boolean(),
          }),
        ),
        nameConflict: z.boolean(),
      })
      .optional(),
    conflicts: z.array(z.string()),
  }),
);

export type ModelReferenceEntryContract = z.infer<typeof modelReferenceEntrySchema>;
export type ModelReferenceSyncStatusContract = z.infer<typeof modelReferenceSyncStatusSchema>;
export type RefreshModelReferenceRequest = z.infer<typeof refreshModelReferenceRequestSchema>;
export type RecommendModelReferenceRequest = z.infer<typeof recommendModelReferenceRequestSchema>;
