import type { FastifyInstance } from 'fastify';
import {
  debugContentLogResponseSchema,
  listDebugContentLogsResponseSchema,
} from '@manageyourllm/contracts';
import { ObservabilityRepository } from '../../../infrastructure/db/repositories/observability.repository.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';

export interface DebugContentRouteDeps {
  db: Db;
}

export async function debugContentRoutes(
  app: FastifyInstance,
  deps: DebugContentRouteDeps,
): Promise<void> {
  const repo = new ObservabilityRepository(deps.db);

  app.get('/', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const limit = Math.min(Number(query.limit ?? '50'), 200);
    const rows = await repo.listRecentDebugContentLogs(Number.isNaN(limit) ? 50 : limit);
    return listDebugContentLogsResponseSchema.parse({
      data: rows.map((r) => serializeForContract(r)),
      total: rows.length,
    });
  });

  app.get('/:traceId', async (req, reply) => {
    const { traceId } = req.params as { traceId: string };
    const row = await repo.findDebugContentLogByTraceId(traceId);
    if (!row) {
      return reply.status(404).send({
        error: { message: '调试日志不存在', type: 'not_found', code: 'debug_content_not_found' },
      });
    }
    return debugContentLogResponseSchema.parse({ data: serializeForContract(row) });
  });
}
