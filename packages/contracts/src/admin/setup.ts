import { z } from 'zod';
import { successEnvelope } from '../envelope.js';

export const setupStatusResponseSchema = successEnvelope(
  z.object({
    hasAdmin: z.boolean(),
    needsSetup: z.boolean(),
    hasSafeSecret: z.boolean(),
    hasUpstream: z.boolean(),
    hasModel: z.boolean(),
    hasClientKey: z.boolean(),
    complete: z.boolean(),
  }),
);

export const setupSecurityRequestSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
  displayName: z.string().optional(),
});

export const setupSecurityResponseSchema = successEnvelope(
  z.object({
    ok: z.boolean(),
    created: z.boolean().optional(),
    needsSetup: z.boolean().optional(),
  }),
);

export const setupUpstreamRequestSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  providerPresetId: z.string().optional(),
  providerType: z.string().min(1),
  baseUrl: z.string().url('必须是有效 URL'),
  apiKey: z.string().min(1, 'API Key 不能为空'),
  supportedModels: z.array(z.string()).optional(),
});

export const setupUpstreamResponseSchema = successEnvelope(
  z.object({ providerAccountId: z.string() }),
);

export const setupModelInputSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().optional(),
  candidates: z.array(
    z.object({
      providerAccountId: z.string(),
      realModelName: z.string().min(1),
      priority: z.number().int().min(0).default(100),
      enabled: z.boolean().default(true),
    }),
  ),
});

export const setupModelsRequestSchema = z.object({
  models: z.array(setupModelInputSchema).min(1, '至少选择一个模型'),
});

export const setupModelsResponseSchema = successEnvelope(
  z.object({ modelIds: z.array(z.string()) }),
);

export const setupClientKeyResponseSchema = successEnvelope(
  z.object({
    clientKeyId: z.string(),
    rawKey: z.string(),
    clientId: z.string(),
  }),
);

export const setupTestRequestQuerySchema = z.object({
  model: z.string().min(1),
});

export const setupTestRequestResponseSchema = successEnvelope(z.object({ curl: z.string() }));

export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;
export type SetupSecurityRequest = z.infer<typeof setupSecurityRequestSchema>;
export type SetupSecurityResponse = z.infer<typeof setupSecurityResponseSchema>;
export type SetupUpstreamRequest = z.infer<typeof setupUpstreamRequestSchema>;
export type SetupUpstreamResponse = z.infer<typeof setupUpstreamResponseSchema>;
export type SetupModelsRequest = z.infer<typeof setupModelsRequestSchema>;
export type SetupModelsResponse = z.infer<typeof setupModelsResponseSchema>;
export type SetupClientKeyResponse = z.infer<typeof setupClientKeyResponseSchema>;
export type SetupTestRequestQuery = z.infer<typeof setupTestRequestQuerySchema>;
export type SetupTestRequestResponse = z.infer<typeof setupTestRequestResponseSchema>;
