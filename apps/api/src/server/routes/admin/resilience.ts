import type { FastifyInstance } from 'fastify';
import {
  listBreakersResponseSchema,
  resetBreakerQuerySchema,
  resetBreakerResponseSchema,
  stickyOverviewResponseSchema,
  stickyQuerySchema,
} from '@manageyourllm/contracts';
import { ResilienceService } from '../../../application/resilience.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';
import type { StickyBindingRow, StickySessionRow } from '../../../infrastructure/db/schema.js';

function mapStickyBinding(row: StickyBindingRow) {
  const { clientId, clientKeyId, ...rest } = row;
  return { ...rest, clientId, clientKeyId };
}

function mapStickySession(row: StickySessionRow) {
  const { clientKeyId, ...rest } = row;
  return { ...rest, clientKeyId };
}

function mapStickyOverview(overview: {
  bindings: StickyBindingRow[];
  sessions: StickySessionRow[];
}) {
  return {
    bindings: overview.bindings.map(mapStickyBinding),
    sessions: overview.sessions.map(mapStickySession),
  };
}

export interface ResilienceRouteDeps {
  db: Db;
}

export async function resilienceRoutes(
  app: FastifyInstance,
  deps: ResilienceRouteDeps,
): Promise<void> {
  const service = new ResilienceService(deps.db);

  app.get('/breakers', async () => {
    const breakers = await service.listBreakers();
    return listBreakersResponseSchema.parse({ data: serializeForContract(breakers) });
  });

  app.post('/breakers/:providerAccountId/:realModelName/reset', async (req) => {
    const { providerAccountId, realModelName } = req.params as {
      providerAccountId: string;
      realModelName: string;
    };
    // 收口 #3：endpointId 必填，用 zod schema 校验而非 throw plain Error。
    // 缺 endpointId 会返回 400 + 结构化错误体（之前是 500）。
    const query = resetBreakerQuerySchema.parse(req.query);
    const reset = await service.resetBreaker(providerAccountId, realModelName, query.endpointId);
    return resetBreakerResponseSchema.parse({ data: serializeForContract(reset) });
  });

  app.get('/sticky', async (req) => {
    const query = stickyQuerySchema.parse(req.query);
    const overview = await service.getStickyOverview({
      clientKeyId: query.clientKeyId,
      requestedTargetName: query.requestedTargetName,
    });
    return stickyOverviewResponseSchema.parse({
      data: serializeForContract(mapStickyOverview(overview)),
    });
  });
}
