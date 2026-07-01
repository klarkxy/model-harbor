import type { FastifyInstance } from 'fastify';
import {
  usageDashboardResponseSchema,
  dailyConsumptionStatsResponseSchema,
} from '@manageyourllm/contracts';
import { UsageService } from '../../../application/usage.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';
import type { UsageRecordRow } from '../../../infrastructure/db/schema.js';

export interface UsageRouteDeps {
  db: Db;
}

function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function toDayDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function usageRoutes(app: FastifyInstance, deps: UsageRouteDeps): Promise<void> {
  const service = new UsageService(deps.db);

  app.get('/dashboard', async (req) => {
    const query = req.query as { since?: string };
    const since = query.since ? new Date(query.since) : dayStart(new Date());
    const dashboard = await service.getDashboard(since);
    const data = {
      ...dashboard,
      recent: dashboard.recent.map((r: UsageRecordRow) => {
        const { clientId, clientKeyId, ...rest } = r;
        return { ...rest, clientId, clientKeyId };
      }),
    };
    return usageDashboardResponseSchema.parse({ data: serializeForContract(data) });
  });

  app.get('/daily', async (req) => {
    const query = req.query as { date?: string };
    const dayDate = query.date ?? toDayDate(new Date());
    const rows = await service.getDailyStatsByDay(dayDate);
    return dailyConsumptionStatsResponseSchema.parse({ data: serializeForContract(rows) });
  });
}
