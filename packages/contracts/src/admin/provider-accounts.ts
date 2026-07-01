import { z } from 'zod';
import { successEnvelope, listEnvelope } from '../envelope.js';

// Phase 2 Slice 1：Provider Account 是 v1 的账号边界（替代旧 Upstream Key）。
// 本 contract 是新正式入口；`admin/upstream-keys.ts` 标 deprecated 后
// 在 Phase 10 一起删除。

export const providerAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  providerPresetId: z.string().nullable(),
  providerType: z.string(),
  baseUrl: z.string(),
  authType: z.string(),
  apiKeyPrefix: z.string(),
  authConfigCiphertext: z.string().nullable().optional(),
  defaultHeadersJson: z.record(z.string()).nullable().optional(),
  extraHeadersJson: z.record(z.string()).nullable().optional(),
  extraParamsJson: z.record(z.unknown()).nullable().optional(),
  supportedModelsJson: z.array(z.string()),
  endpointsJson: z.unknown().nullable().optional(),
  displayOrder: z.number(),
  enabled: z.boolean(),
  frozen: z.boolean(),
  frozenReason: z.string().nullable().optional(),
  cooldownUntil: z.string().datetime().nullable().optional(),
  stickySessionTtlMs: z.number(),
  lastUsedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const providerAccountQuotaSchema = z.object({
  id: z.string(),
  // 物理列名仍是 `upstream_key_id`，对外 contract 一律用 `providerAccountId`。
  providerAccountId: z.string(),
  period: z.enum(['hour', 'day', 'week', 'month', 'total']),
  requestLimit: z.number().nullable().optional(),
  inputTokenLimit: z.number().nullable().optional(),
  outputTokenLimit: z.number().nullable().optional(),
  totalTokenLimit: z.number().nullable().optional(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const providerAccountWithQuotaSchema = providerAccountSchema.extend({
  quota: providerAccountQuotaSchema.nullable().optional(),
});

export const createProviderAccountRequestSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  providerPresetId: z.string().optional(),
  providerType: z.string().min(1),
  baseUrl: z.string().url('必须是有效 URL'),
  apiKey: z.string().min(1, 'API Key 不能为空'),
  authConfigJson: z.string().optional(),
  defaultHeaders: z.record(z.string()).optional(),
  extraHeaders: z.record(z.string()).optional(),
  extraParams: z.record(z.unknown()).optional(),
  supportedModels: z.array(z.string()).optional(),
  endpoints: z.array(z.unknown()).optional(),
  displayOrder: z.number().optional(),
  enabled: z.boolean().optional(),
  stickySessionTtlMs: z.number().optional(),
  quota: z
    .object({
      period: z.enum(['hour', 'day', 'week', 'month', 'total']),
      requestLimit: z.number().nullable().optional(),
      inputTokenLimit: z.number().nullable().optional(),
      outputTokenLimit: z.number().nullable().optional(),
      totalTokenLimit: z.number().nullable().optional(),
      enabled: z.boolean().optional(),
    })
    .optional(),
});

export const updateProviderAccountRequestSchema = createProviderAccountRequestSchema
  .partial()
  .omit({ apiKey: true });

export const rotateApiKeyRequestSchema = z.object({
  apiKey: z.string().min(1, 'API Key 不能为空'),
});

export const reorderProviderAccountsRequestSchema = z
  .array(
    z.object({
      id: z.string(),
      displayOrder: z.number().int(),
    }),
  )
  .min(1, '至少提供一个 provider account 排序项');

export const freezeProviderAccountRequestSchema = z.object({
  frozen: z.boolean().optional().default(true),
  reason: z.string().optional(),
});

export const pingProviderAccountRequestSchema = z.object({
  model: z.string().optional(),
  // Phase 2 Slice 2：可选显式 endpoint id。指定时 ping 该 endpoint；
  // 未指定时由 service 选第一个 enabled endpoint（OpenAI 兼容优先）。
  endpointId: z.string().optional(),
});

export const discoveredModelSchema = z.object({
  id: z.string(),
  object: z.string(),
  ownedBy: z.string().optional(),
});

export const discoverModelsResponseSchema = successEnvelope(z.array(discoveredModelSchema));
export const pingProviderAccountResponseSchema = successEnvelope(
  z.object({ ok: z.boolean(), latencyMs: z.number(), error: z.string().nullable().optional() }),
);
export const rotateApiKeyResponseSchema = successEnvelope(providerAccountSchema);
export const listProviderAccountsResponseSchema = listEnvelope(providerAccountWithQuotaSchema);
export const providerAccountResponseSchema = successEnvelope(providerAccountWithQuotaSchema);

export type ProviderAccountContract = z.infer<typeof providerAccountSchema>;
export type ProviderAccountQuotaContract = z.infer<typeof providerAccountQuotaSchema>;
export type CreateProviderAccountRequest = z.infer<typeof createProviderAccountRequestSchema>;
export type UpdateProviderAccountRequest = z.infer<typeof updateProviderAccountRequestSchema>;
export type ReorderProviderAccountsRequest = z.infer<typeof reorderProviderAccountsRequestSchema>;
export type FreezeProviderAccountRequest = z.infer<typeof freezeProviderAccountRequestSchema>;
export type PingProviderAccountRequest = z.infer<typeof pingProviderAccountRequestSchema>;
export type DiscoveredModel = z.infer<typeof discoveredModelSchema>;
