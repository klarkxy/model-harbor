import { z } from 'zod';
import { successEnvelope } from '../envelope.js';

export const usageSummarySchema = z.object({
  requestCount: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  stickyHitCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  stickyHitRate: z.number().min(0).max(1),
  costAmount: z.number().nullable(),
  costCurrency: z.string().nullable(),
  unpricedCount: z.number().int().nonnegative(),
});

export const usageGroupItemSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  requestCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costAmount: z.number().nullable(),
  costCurrency: z.string().nullable(),
  unpricedCount: z.number().int().nonnegative(),
});

export const usageRecordSchema = z.object({
  id: z.string(),
  appId: z.string(),
  consumerKeyId: z.string(),
  requestedTargetName: z.string(),
  resolvedTargetType: z.enum(['public_model', 'model_group']),
  resolvedTargetId: z.string(),
  upstreamKeyId: z.string(),
  requestTraceId: z.string().nullable(),
  realModelName: z.string(),
  sourceProtocol: z.string(),
  providerType: z.string(),
  stream: z.boolean(),
  stickyHit: z.boolean(),
  sessionStickyHit: z.boolean(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  cacheReadTokens: z.number().nullable(),
  cacheWriteTokens: z.number().nullable(),
  status: z.string(),
  errorCode: z.string().nullable(),
  latencyMs: z.number(),
  costAmount: z.number().nullable(),
  costCurrency: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const usageGroupsSchema = z.object({
  byApp: z.array(usageGroupItemSchema),
  byConsumerKey: z.array(usageGroupItemSchema),
  byUpstream: z.array(usageGroupItemSchema),
  byTarget: z.array(usageGroupItemSchema),
});

export const usageDashboardSchema = z.object({
  summary: usageSummarySchema,
  groups: usageGroupsSchema,
  recent: z.array(usageRecordSchema),
});

export const usageDashboardResponseSchema = successEnvelope(usageDashboardSchema);

export const dailyConsumptionStatSchema = z.object({
  id: z.string(),
  upstreamKeyId: z.string(),
  realModelName: z.string(),
  dayDate: z.string(),
  requestCount: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  avgLatencyMs: z.number().int().nonnegative(),
  totalCostAmount: z.number(),
  costCurrency: z.string(),
  updatedAt: z.string().datetime(),
});

export const dailyConsumptionStatsResponseSchema = successEnvelope(
  z.array(dailyConsumptionStatSchema),
);

export type UsageSummaryContract = z.infer<typeof usageSummarySchema>;
export type UsageGroupItemContract = z.infer<typeof usageGroupItemSchema>;
export type UsageRecordContract = z.infer<typeof usageRecordSchema>;
export type UsageDashboardContract = z.infer<typeof usageDashboardSchema>;
export type DailyConsumptionStatContract = z.infer<typeof dailyConsumptionStatSchema>;
