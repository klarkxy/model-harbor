import type { FastifyInstance } from 'fastify';
import {
  setupStatusResponseSchema,
  setupSecurityRequestSchema,
  setupSecurityResponseSchema,
  setupUpstreamRequestSchema,
  setupUpstreamResponseSchema,
  setupModelsRequestSchema,
  setupModelsResponseSchema,
  setupClientKeyResponseSchema,
  setupTestRequestQuerySchema,
  setupTestRequestResponseSchema,
} from '@manageyourllm/contracts';
import { SetupService } from '../../../application/setup.service.js';
import type { Db } from '../../../infrastructure/db/client.js';

export interface SetupRouteDeps {
  db: Db;
  secretKey: string;
  publicBaseUrl: string;
}

export async function setupRoutes(app: FastifyInstance, deps: SetupRouteDeps): Promise<void> {
  const service = new SetupService(deps.db, deps.secretKey);

  app.get('/status', async () => {
    const status = await service.getStatus();
    return setupStatusResponseSchema.parse({ data: status });
  });

  app.post('/security', async (req) => {
    const body = setupSecurityRequestSchema.parse(req.body);
    const result = await service.verifySecurity(body.username, body.password, body.displayName);
    const status = await service.getStatus();
    return setupSecurityResponseSchema.parse({
      data: { ok: result.ok, created: result.created, needsSetup: status.needsSetup },
    });
  });

  app.post('/upstream', async (req) => {
    const body = setupUpstreamRequestSchema.parse(req.body);
    const result = await service.createProviderAccount(body);
    return setupUpstreamResponseSchema.parse({
      data: { providerAccountId: result.providerAccountId },
    });
  });

  app.post('/models', async (req) => {
    const body = setupModelsRequestSchema.parse(req.body);
    // setup service 会按 providerAccountId 自动取第一个 endpoint 补 endpointId（v1 收口）。
    const result = await service.createModels(
      body.models.map((m) => ({
        ...m,
        candidates: m.candidates.map((c) => ({
          ...c,
        })),
      })),
    );
    return setupModelsResponseSchema.parse({ data: result });
  });

  app.post('/client-key', async () => {
    const result = await service.createDefaultClientKey();
    return setupClientKeyResponseSchema.parse({ data: result });
  });

  app.get('/test-request', async (req) => {
    const query = setupTestRequestQuerySchema.parse(req.query);
    const status = await service.getStatus();
    if (!status.hasClientKey) {
      return setupTestRequestResponseSchema.parse({ data: { curl: '' } });
    }
    // 简化：从 settings 或环境取 baseUrl；当前使用 publicBaseUrl。
    const curl = service.generateTestRequest(deps.publicBaseUrl, '<your-client-key>', query.model);
    return setupTestRequestResponseSchema.parse({ data: { curl } });
  });
}
