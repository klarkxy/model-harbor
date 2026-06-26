import { z } from 'zod';
import { successEnvelope, listEnvelope } from '../envelope.js';

export const planSchema = z.object({
  id: z.string(),
  planType: z.enum(['token', 'coding']),
  name: z.string(),
  providerType: z.string().nullable(),
  upstreamKeyId: z.string().nullable(),
  totalAmount: z.number(),
  usedAmount: z.number(),
  remainingAmount: z.number(),
  unit: z.string(),
  period: z.string(),
  purchasedAt: z.string().datetime(),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime().nullable(),
  reminderDays: z.number(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createPlanRequestSchema = z.object({
  planType: z.enum(['token', 'coding']),
  name: z.string().min(1),
  providerType: z.string().nullable().optional(),
  upstreamKeyId: z.string().nullable().optional(),
  totalAmount: z.number().int().nonnegative(),
  usedAmount: z.number().int().nonnegative().default(0),
  unit: z.string().min(1),
  period: z.string().min(1),
  purchasedAt: z.string().datetime(),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime().nullable().optional(),
  reminderDays: z.number().int().nonnegative().default(7),
  notes: z.string().nullable().optional(),
});

export const updatePlanRequestSchema = z.object({
  planType: z.enum(['token', 'coding']).optional(),
  name: z.string().min(1).optional(),
  providerType: z.string().nullable().optional(),
  upstreamKeyId: z.string().nullable().optional(),
  totalAmount: z.number().int().nonnegative().optional(),
  usedAmount: z.number().int().nonnegative().optional(),
  unit: z.string().min(1).optional(),
  period: z.string().min(1).optional(),
  purchasedAt: z.string().datetime().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  reminderDays: z.number().int().nonnegative().optional(),
  notes: z.string().nullable().optional(),
});

export const planReminderSchema = z.object({
  plan: planSchema,
  reasons: z.array(z.enum(['expiring', 'low_balance'])),
  daysUntilExpiry: z.number().nullable(),
  remainingRatio: z.number().min(0).max(1),
});

export const listPlansResponseSchema = listEnvelope(planSchema);
export const planResponseSchema = successEnvelope(planSchema);
export const planRemindersResponseSchema = listEnvelope(planReminderSchema);

export type PlanContract = z.infer<typeof planSchema>;
export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>;
export type UpdatePlanRequest = z.infer<typeof updatePlanRequestSchema>;
export type PlanReminderContract = z.infer<typeof planReminderSchema>;
