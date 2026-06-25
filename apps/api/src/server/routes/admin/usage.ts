import type { FastifyInstance } from 'fastify';
import { usageDashboardResponseSchema } from '@manageyourllm/contracts';
import { UsageService } from '../../../application/usage.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';

export interface UsageRouteDeps {
  db: Db;
}

function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

export async function usageRoutes(app: FastifyInstance, deps: UsageRouteDeps): Promise<void> {
  const service = new UsageService(deps.db);

  app.get('/dashboard', async (req) => {
    const query = req.query as { since?: string };
    const since = query.since ? new Date(query.since) : dayStart(new Date());
    const dashboard = await service.getDashboard(since);
    return usageDashboardResponseSchema.parse({ data: serializeForContract(dashboard) });
  });
}
