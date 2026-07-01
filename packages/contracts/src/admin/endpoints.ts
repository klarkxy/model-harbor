import { z } from 'zod';
import { successEnvelope, listEnvelope } from '../envelope.js';

// Phase 2 Slice 2：endpoint 是一等对象。
// 本 contract 是 `/admin/endpoints` 路由的正式 wire schema。

export const endpointSchema = z.object({
  id: z.string(),
  providerAccountId: z.string(),
  protocol: z.string(),
  baseUrl: z.string(),
  path: z.string().nullable().optional(),
  providerType: z.string(),
  defaultHeadersJson: z.record(z.string()).nullable().optional(),
  extraHeadersJson: z.record(z.string()).nullable().optional(),
  extraParamsJson: z.record(z.unknown()).nullable().optional(),
  capabilities: z.array(z.unknown()).default([]),
  enabled: z.boolean(),
  displayOrder: z.number(),
  isPresetDefault: z.boolean(),
  source: z.enum(['user', 'preset']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const listEndpointsResponseSchema = listEnvelope(endpointSchema);
export const endpointResponseSchema = successEnvelope(endpointSchema);

export const createEndpointRequestSchema = z.object({
  providerAccountId: z.string().min(1, 'providerAccountId 不能为空'),
  protocol: z.string().min(1, 'protocol 不能为空'),
  baseUrl: z.string().min(1, 'baseUrl 不能为空'),
  path: z.string().optional(),
  providerType: z.string().min(1),
  defaultHeaders: z.record(z.string()).optional(),
  extraHeaders: z.record(z.string()).optional(),
  extraParams: z.record(z.unknown()).optional(),
  capabilities: z.array(z.unknown()).optional(),
  enabled: z.boolean().optional(),
  displayOrder: z.number().optional(),
});

export const updateEndpointRequestSchema = z.object({
  protocol: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
  path: z.string().nullable().optional(),
  providerType: z.string().min(1).optional(),
  defaultHeaders: z.record(z.string()).nullable().optional(),
  extraHeaders: z.record(z.string()).nullable().optional(),
  extraParams: z.record(z.unknown()).nullable().optional(),
  capabilities: z.array(z.unknown()).optional(),
  enabled: z.boolean().optional(),
  displayOrder: z.number().optional(),
});

export const setEndpointEnabledRequestSchema = z.object({
  enabled: z.boolean(),
});

export const reorderEndpointsRequestSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        displayOrder: z.number().int(),
      }),
    )
    .min(1, '至少提供一个 endpoint 排序项'),
});

export const resetEndpointDefaultsRequestSchema = z.object({
  providerAccountId: z.string().min(1),
});

export const pingEndpointRequestSchema = z.object({
  model: z.string().optional(),
});

export const endpointHealthSchema = z.object({
  endpointId: z.string(),
  baseUrl: z.string(),
  status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
  latencyMs: z.number().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  lastCheckedAt: z.string().datetime().nullable().optional(),
});

export const endpointHealthResponseSchema = successEnvelope(endpointHealthSchema);
export const resetEndpointDefaultsResponseSchema = listEnvelope(endpointSchema);

export type EndpointContract = z.infer<typeof endpointSchema>;
export type CreateEndpointRequest = z.infer<typeof createEndpointRequestSchema>;
export type UpdateEndpointRequest = z.infer<typeof updateEndpointRequestSchema>;
export type SetEndpointEnabledRequest = z.infer<typeof setEndpointEnabledRequestSchema>;
export type ReorderEndpointsRequest = z.infer<typeof reorderEndpointsRequestSchema>;
export type ResetEndpointDefaultsRequest = z.infer<typeof resetEndpointDefaultsRequestSchema>;
export type PingEndpointRequest = z.infer<typeof pingEndpointRequestSchema>;
export type EndpointHealth = z.infer<typeof endpointHealthSchema>;
