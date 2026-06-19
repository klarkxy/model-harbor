// Admin routes for global settings and circuit breaker management (M9).

import type { FastifyInstance } from 'fastify';
import { type Db } from '../db/index.js';
import {
  ensureDefaultCircuitBreakerSettings,
  getCircuitBreakerSettings,
  listCircuitBreakers,
  resetCircuitBreaker,
  updateCircuitBreakerSettings,
} from '../router/circuit-breaker.js';

export interface SettingsRouteDeps {
  db: Db;
}

export function registerSettingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps): void {
  const { db } = deps;

  app.get('/api/admin/settings', async () => {
    await ensureDefaultCircuitBreakerSettings(db);
    const settings = await getCircuitBreakerSettings(db);
    return {
      circuitBreaker: {
        enabled: settings.circuitBreakerEnabled,
        failureThreshold: settings.circuitBreakerFailureThreshold,
        baseCooldownMs: settings.circuitBreakerBaseCooldownMs,
        maxCooldownMs: settings.circuitBreakerMaxCooldownMs,
        halfOpenSuccessCount: settings.circuitBreakerHalfOpenSuccessCount,
      },
      endpointHealth: {
        probeEnabled: settings.endpointHealthProbeEnabled,
        probeIntervalMs: settings.endpointHealthProbeIntervalMs,
        probeTimeoutMs: settings.endpointHealthProbeTimeoutMs,
        degradedLatencyMs: settings.endpointHealthProbeDegradedLatencyMs,
      },
    };
  });

  app.put('/api/admin/settings', async (req, reply) => {
    const body = (req.body ?? {}) as {
      circuitBreaker?: {
        enabled?: boolean;
        failureThreshold?: number;
        baseCooldownMs?: number;
        maxCooldownMs?: number;
        halfOpenSuccessCount?: number;
      };
      endpointHealth?: {
        probeEnabled?: boolean;
        probeIntervalMs?: number;
        probeTimeoutMs?: number;
        degradedLatencyMs?: number;
      };
    };
    const cbInput = body.circuitBreaker ?? {};
    const ehInput = body.endpointHealth ?? {};
    const updated = await updateCircuitBreakerSettings(db, {
      circuitBreakerEnabled: cbInput.enabled,
      circuitBreakerFailureThreshold: cbInput.failureThreshold,
      circuitBreakerBaseCooldownMs: cbInput.baseCooldownMs,
      circuitBreakerMaxCooldownMs: cbInput.maxCooldownMs,
      circuitBreakerHalfOpenSuccessCount: cbInput.halfOpenSuccessCount,
      endpointHealthProbeEnabled: ehInput.probeEnabled,
      endpointHealthProbeIntervalMs: ehInput.probeIntervalMs,
      endpointHealthProbeTimeoutMs: ehInput.probeTimeoutMs,
      endpointHealthProbeDegradedLatencyMs: ehInput.degradedLatencyMs,
    });
    return {
      circuitBreaker: {
        enabled: updated.circuitBreakerEnabled,
        failureThreshold: updated.circuitBreakerFailureThreshold,
        baseCooldownMs: updated.circuitBreakerBaseCooldownMs,
        maxCooldownMs: updated.circuitBreakerMaxCooldownMs,
        halfOpenSuccessCount: updated.circuitBreakerHalfOpenSuccessCount,
      },
      endpointHealth: {
        probeEnabled: updated.endpointHealthProbeEnabled,
        probeIntervalMs: updated.endpointHealthProbeIntervalMs,
        probeTimeoutMs: updated.endpointHealthProbeTimeoutMs,
        degradedLatencyMs: updated.endpointHealthProbeDegradedLatencyMs,
      },
    };
  });

  app.get('/api/admin/circuit-breakers', async (req) => {
    const q = (req.query ?? {}) as { state?: 'closed' | 'open' | 'half_open'; limit?: string };
    const limit = Math.min(500, Math.max(1, Number(q.limit ?? '100') || 100));
    const items = await listCircuitBreakers(db, { limit, state: q.state });
    return { items };
  });

  app.post('/api/admin/circuit-breakers/:id/reset', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await resetCircuitBreaker(db, { id, now: new Date() });
    if (!ok) {
      reply.code(404).send({ error: { message: 'Circuit breaker not found', type: 'not_found', code: 'not_found' } });
      return;
    }
    return { ok: true };
  });
}
