import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { successEnvelope } from '@manageyourllm/contracts';
import { MaintenanceService } from '../../../application/maintenance.service.js';
import type { Db } from '../../../infrastructure/db/client.js';

export interface MaintenanceRouteDeps {
  db: Db;
}

export async function maintenanceRoutes(
  app: FastifyInstance,
  deps: MaintenanceRouteDeps,
): Promise<void> {
  const service = new MaintenanceService({ db: deps.db });

  app.post('/run', async () => {
    const result = await service.run();
    return successEnvelope(z.object({ ok: z.boolean(), cleanedAt: z.string().datetime() })).parse({
      data: { ok: true, cleanedAt: result.cleanedAt.toISOString() },
    });
  });
}
