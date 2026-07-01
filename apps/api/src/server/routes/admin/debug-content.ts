import type { FastifyInstance } from 'fastify';
import {
  listDebugContentLogsResponseSchema,
  debugContentLogResponseSchema,
} from '@manageyourllm/contracts';
import { DebugContentService } from '../../../application/debug-content.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import { notFound } from '../../helpers/errors.js';
import type { Db } from '../../../infrastructure/db/client.js';

export interface DebugContentRouteDeps {
  db: Db;
}

// v1 Phase 7：debug content 作为 Trace 页的临时 tab 提供临时 API。
// 默认关闭（contentLogEnabled = false），由 Settings 控制。
export async function debugContentRoutes(
  app: FastifyInstance,
  deps: DebugContentRouteDeps,
): Promise<void> {
  const service = new DebugContentService(deps.db);

  app.get('/', async (req) => {
    const { limit } = req.query as { limit?: string };
    const n = limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500) : 50;
    const logs = await service.listRecentLogs(n);
    return listDebugContentLogsResponseSchema.parse({ data: serializeForContract(logs) });
  });

  app.get('/:traceId', async (req, reply) => {
    const { traceId } = req.params as { traceId: string };
    const log = await service.getLogByTraceId(traceId);
    if (!log) {
      return notFound(reply, 'Debug content log not found', 'debug_content_not_found');
    }
    return debugContentLogResponseSchema.parse({ data: serializeForContract(log) });
  });
}
