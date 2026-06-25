import { z } from 'zod';
import { successEnvelope } from '../envelope.js';

export const settingsSchema = z.object({
  id: z.string(),
  circuitBreakerEnabled: z.boolean(),
  circuitBreakerFailureThreshold: z.number(),
  circuitBreakerBaseCooldownMs: z.number(),
  circuitBreakerMaxCooldownMs: z.number(),
  circuitBreakerHalfOpenSuccessCount: z.number(),
  endpointHealthProbeEnabled: z.boolean(),
  endpointHealthProbeIntervalMs: z.number(),
  endpointHealthProbeTimeoutMs: z.number(),
  endpointHealthProbeDegradedLatencyMs: z.number(),
  firstTokenTimeoutMs: z.number(),
  contentLogEnabled: z.boolean(),
  contentLogExpiresAt: z.string().datetime().nullable().optional(),
  contentLogMaxRows: z.number(),
  contentLogRetentionDays: z.number(),
  contentLogMaxPayloadBytes: z.number(),
  publicEndpointsBasePath: z.string(),
  publicBaseUrl: z.string().nullable().optional(),
  gatewayBasePath: z.string().nullable().optional(),
  defaultRequestTimeoutMs: z.number().nullable().optional(),
  defaultRetries: z.number().nullable().optional(),
  enableStickySession: z.boolean().nullable().optional(),
  enableCircuitBreaker: z.boolean().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const updateSettingsRequestSchema = z.object({
  publicBaseUrl: z.string().url('必须是有效 URL').nullable().optional(),
  gatewayBasePath: z
    .string()
    .regex(/^\/[a-zA-Z0-9_\-/]*$/, '网关 base path 必须以 / 开头且只包含合法字符')
    .nullable()
    .optional(),
  defaultRequestTimeoutMs: z.number().int().min(1000).optional(),
  defaultRetries: z.number().int().min(0).max(5).optional(),
  enableStickySession: z.boolean().optional(),
  enableCircuitBreaker: z.boolean().optional(),
  contentLogEnabled: z.boolean().optional(),
  contentLogExpiresAt: z.string().datetime().nullable().optional(),
  contentLogMaxRows: z.number().int().min(1).optional(),
  contentLogRetentionDays: z.number().int().min(1).optional(),
  contentLogMaxPayloadBytes: z.number().int().min(100).optional(),
});

export const settingsResponseSchema = successEnvelope(settingsSchema);

export type SettingsContract = z.infer<typeof settingsSchema>;
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
