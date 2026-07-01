import { z } from 'zod';
import { successEnvelope, listEnvelope } from '../envelope.js';

// Client + Client Key 合并 contract（Phase 6 收口）。
// v1 概念：Client 一个 active key，不做权限、不做 client type。
// Client key 是 Client 内部实现细节，对外仍可查询/轮换/吊销/删除，
// 但不再作为独立业务资源管理。

// ---- Client ----

export const clientSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createClientRequestSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const updateClientRequestSchema = createClientRequestSchema.partial();

export const listClientsResponseSchema = listEnvelope(clientSchema);
export const clientResponseSchema = successEnvelope(clientSchema);
// Phase 6：Client 创建时直接生成 active key —— 响应里带 rawKey 供前端展示一次。
export const createClientResponseSchema = successEnvelope(
  z.object({ client: clientSchema, rawKey: z.string() }),
);

export type ClientContract = z.infer<typeof clientSchema>;
export type CreateClientRequest = z.infer<typeof createClientRequestSchema>;
export type UpdateClientRequest = z.infer<typeof updateClientRequestSchema>;
export type CreateClientResponse = z.infer<typeof createClientResponseSchema>;

// ---- Client Key ----

export const clientKeySchema = z.object({
  id: z.string(),
  clientId: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  keySuffix: z.string(),
  enabled: z.boolean(),
  revokedAt: z.string().datetime().nullable().optional(),
  lastUsedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createClientKeyRequestSchema = z.object({
  clientId: z.string(),
  name: z.string().min(1, '名称不能为空'),
  enabled: z.boolean().optional(),
});

export const updateClientKeyRequestSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export const createClientKeyResponseSchema = successEnvelope(
  z.object({ clientKey: clientKeySchema, rawKey: z.string() }),
);

export const rotateClientKeyResponseSchema = successEnvelope(
  z.object({ clientKey: clientKeySchema, rawKey: z.string() }),
);

export const revokeClientKeyResponseSchema = successEnvelope(
  z.object({ clientKey: clientKeySchema }),
);

export const listClientKeysResponseSchema = listEnvelope(clientKeySchema);
export const clientKeyResponseSchema = successEnvelope(clientKeySchema);

export type ClientKeyContract = z.infer<typeof clientKeySchema>;
export type CreateClientKeyRequest = z.infer<typeof createClientKeyRequestSchema>;
export type UpdateClientKeyRequest = z.infer<typeof updateClientKeyRequestSchema>;
export type CreateClientKeyResponse = z.infer<typeof createClientKeyResponseSchema>;
export type RevokeClientKeyResponse = z.infer<typeof revokeClientKeyResponseSchema>;
