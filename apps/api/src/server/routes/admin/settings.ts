import type { FastifyInstance } from 'fastify';
import { settingsResponseSchema, updateSettingsRequestSchema } from '@manageyourllm/contracts';
import { SettingsService } from '../../../application/settings.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';

export interface SettingsRouteDeps {
  db: Db;
}

export async function settingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps): Promise<void> {
  const service = new SettingsService(deps.db);

  app.get('/', async () => {
    const settings = await service.getSettings();
    return settingsResponseSchema.parse({ data: serializeForContract(settings) });
  });

  app.patch('/', async (req) => {
    const body = updateSettingsRequestSchema.parse(req.body);
    const settings = await service.updateSettings({
      publicBaseUrl: body.publicBaseUrl,
      defaultRequestTimeoutMs: body.defaultRequestTimeoutMs,
      defaultRetries: body.defaultRetries,
      enableStickySession: body.enableStickySession,
      enableCircuitBreaker: body.enableCircuitBreaker,
      firstTokenTimeoutMs: body.firstTokenTimeoutMs,
      circuitBreakerFailureThreshold: body.circuitBreakerFailureThreshold,
      circuitBreakerBaseCooldownMs: body.circuitBreakerBaseCooldownMs,
      circuitBreakerMaxCooldownMs: body.circuitBreakerMaxCooldownMs,
      circuitBreakerHalfOpenSuccessCount: body.circuitBreakerHalfOpenSuccessCount,
      endpointHealthProbeEnabled: body.endpointHealthProbeEnabled,
      endpointHealthProbeIntervalMs: body.endpointHealthProbeIntervalMs,
      endpointHealthProbeTimeoutMs: body.endpointHealthProbeTimeoutMs,
      endpointHealthProbeDegradedLatencyMs: body.endpointHealthProbeDegradedLatencyMs,
      contentLogEnabled: body.contentLogEnabled,
      contentLogExpiresAt:
        body.contentLogExpiresAt === undefined
          ? undefined
          : body.contentLogExpiresAt === null
            ? null
            : new Date(body.contentLogExpiresAt),
      contentLogMaxRows: body.contentLogMaxRows,
      contentLogRetentionDays: body.contentLogRetentionDays,
      contentLogMaxPayloadBytes: body.contentLogMaxPayloadBytes,
    });
    return settingsResponseSchema.parse({ data: serializeForContract(settings) });
  });
}
