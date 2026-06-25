import type { FastifyInstance } from 'fastify';
import {
  listTracesResponseSchema,
  traceDetailResponseSchema,
} from '@manageyourllm/contracts';
import { TraceService } from '../../../application/trace.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';

export interface TraceRouteDeps {
  db: Db;
}

function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

export async function traceRoutes(app: FastifyInstance, deps: TraceRouteDeps): Promise<void> {
  const service = new TraceService(deps.db);

  app.get('/', async (req, reply) => {
    const query = req.query as { since?: string; limit?: string };
    const since = query.since ? new Date(query.since) : dayStart(new Date());
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 100;
    const traces = await service.listTraces(since, Number.isNaN(limit) ? 100 : Math.min(limit, 100));
    return listTracesResponseSchema.parse({
      data: serializeForContract(traces),
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = await service.getTraceDetail(id);
    if (!detail.summary && detail.events.length === 0) {
      return reply.status(404).send({
        error: { message: 'Trace not found', type: 'not_found', code: 'trace_not_found' },
      });
    }
    return traceDetailResponseSchema.parse({
      data: serializeForContract(detail),
    });
  });
}
