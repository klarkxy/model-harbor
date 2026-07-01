import { z } from 'zod';
import { listEnvelope } from '../envelope.js';

export const providerPresetSchema = z.object({
  id: z.string(),
  source: z.enum(['builtin']),
  name: z.string(),
  providerType: z.string(),
  descriptorJson: z.record(z.unknown()),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const listPresetsResponseSchema = listEnvelope(providerPresetSchema);

export type ProviderPresetContract = z.infer<typeof providerPresetSchema>;
export type ListPresetsResponse = z.infer<typeof listPresetsResponseSchema>;
