import { z } from 'zod';
import { successEnvelope, listEnvelope } from '../envelope.js';

export const circuitBreakerSchema = z.object({
  id: z.string(),
  providerAccountId: z.string(),
  // 收口 #3：circuit breaker 严格绑定 endpoint，contract 必须带 endpointId，
  // 否则前端 reset 按钮拿不到要回传给后端的 endpointId。
  endpointId: z.string(),
  realModelName: z.string(),
  state: z.enum(['closed', 'open', 'half_open']),
  failureCount: z.number(),
  successCount: z.number(),
  openCount: z.number(),
  openedAt: z.string().datetime().nullable().optional(),
  cooldownUntil: z.string().datetime().nullable().optional(),
  lastErrorCode: z.string().nullable().optional(),
  lastErrorMessage: z.string().nullable().optional(),
  updatedAt: z.string().datetime(),
});

export const resetBreakerQuerySchema = z.object({
  endpointId: z.string().min(1, 'endpointId is required'),
});

export const stickyBindingSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientKeyId: z.string(),
  requestedTargetName: z.string(),
  conversationFingerprint: z.string(),
  providerAccountId: z.string(),
  realModelName: z.string(),
  hitCount: z.number(),
  lastUsedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const stickySessionSchema = z.object({
  id: z.string(),
  clientKeyId: z.string(),
  requestedTargetName: z.string(),
  providerAccountId: z.string(),
  realModelName: z.string(),
  ttlMs: z.number(),
  hitCount: z.number(),
  lastUsedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const stickyQuerySchema = z.object({
  clientKeyId: z.string().optional(),
  requestedTargetName: z.string().optional(),
});

export const resetBreakerResponseSchema = successEnvelope(circuitBreakerSchema);
export const listBreakersResponseSchema = listEnvelope(circuitBreakerSchema);
export const listStickyBindingsResponseSchema = listEnvelope(stickyBindingSchema);
export const listStickySessionsResponseSchema = listEnvelope(stickySessionSchema);
export const stickyOverviewResponseSchema = successEnvelope(
  z.object({
    bindings: z.array(stickyBindingSchema),
    sessions: z.array(stickySessionSchema),
  }),
);

export type CircuitBreakerContract = z.infer<typeof circuitBreakerSchema>;
export type StickyBindingContract = z.infer<typeof stickyBindingSchema>;
export type StickySessionContract = z.infer<typeof stickySessionSchema>;
