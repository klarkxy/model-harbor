import { z } from 'zod';
import { successEnvelope, listEnvelope } from '../envelope.js';

export const pricingEntrySchema = z.object({
  id: z.string(),
  providerType: z.string(),
  upstreamKeyId: z.string().nullable(),
  realModelName: z.string(),
  inputPricePer1k: z.number(),
  outputPricePer1k: z.number(),
  currency: z.string(),
  effectiveFrom: z.string().datetime(),
  effectiveUntil: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createPricingEntryRequestSchema = z.object({
  providerType: z.string().min(1),
  upstreamKeyId: z.string().nullable().optional(),
  realModelName: z.string().min(1),
  inputPricePer1k: z.number().int(),
  outputPricePer1k: z.number().int(),
  currency: z.string().min(1).default('USD'),
  effectiveFrom: z.string().datetime(),
  effectiveUntil: z.string().datetime().nullable().optional(),
});

export const updatePricingEntryRequestSchema = z.object({
  providerType: z.string().min(1).optional(),
  upstreamKeyId: z.string().nullable().optional(),
  realModelName: z.string().min(1).optional(),
  inputPricePer1k: z.number().int().optional(),
  outputPricePer1k: z.number().int().optional(),
  currency: z.string().min(1).optional(),
  effectiveFrom: z.string().datetime().optional(),
  effectiveUntil: z.string().datetime().nullable().optional(),
});

export const listPricingEntriesResponseSchema = listEnvelope(pricingEntrySchema);
export const pricingEntryResponseSchema = successEnvelope(pricingEntrySchema);

export type PricingEntryContract = z.infer<typeof pricingEntrySchema>;
export type CreatePricingEntryRequest = z.infer<typeof createPricingEntryRequestSchema>;
export type UpdatePricingEntryRequest = z.infer<typeof updatePricingEntryRequestSchema>;
