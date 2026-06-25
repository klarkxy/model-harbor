import type { FastifyInstance } from 'fastify';
import {
  listModelReferenceResponseSchema,
  modelReferenceSyncStatusResponseSchema,
  refreshModelReferenceRequestSchema,
  refreshModelReferenceResponseSchema,
  recommendModelReferenceRequestSchema,
  recommendModelReferenceResponseSchema,
} from '@manageyourllm/contracts';
import { ModelReferenceService } from '../../../application/model-reference.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';

export interface ModelReferenceRouteDeps {
  db: Db;
}

export async function modelReferenceRoutes(
  app: FastifyInstance,
  deps: ModelReferenceRouteDeps,
): Promise<void> {
  const service = new ModelReferenceService(deps.db);

  app.get('/', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const entries = await service.listEntries({
      region: (query.region as 'global') ?? 'global',
      source: (query.source as 'arena') ?? 'arena',
      provider: query.provider,
      sortBy: (query.sortBy as 'score' | 'rank' | 'votes' | 'fetchedAt') ?? 'score',
      order: (query.order as 'asc' | 'desc') ?? 'desc',
      limit: query.limit ? Number(query.limit) : 100,
    });
    return listModelReferenceResponseSchema.parse({
      data: serializeForContract(entries),
      total: entries.length,
    });
  });

  app.get('/sync-status', async () => {
    const status = await service.getSyncStatus('global', 'arena');
    return modelReferenceSyncStatusResponseSchema.parse({ data: serializeForContract(status) });
  });

  app.post('/refresh', async (req) => {
    const body = refreshModelReferenceRequestSchema.parse(req.body ?? {});
    const result = await service.refresh(
      (body.region as 'global') ?? 'global',
      (body.source as 'arena') ?? 'arena',
      body.force,
    );
    return refreshModelReferenceResponseSchema.parse({ data: result });
  });

  app.post('/recommend', async (req) => {
    const body = recommendModelReferenceRequestSchema.parse(req.body);
    const draft = await service.recommendDraft({
      entryIds: body.entryIds,
      upstreamKeyId: body.upstreamKeyId,
      createGroup: body.createGroup ?? false,
      groupName: body.groupName,
    });
    return recommendModelReferenceResponseSchema.parse({ data: draft });
  });
}
