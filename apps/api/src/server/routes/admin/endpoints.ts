// Phase 2 Slice 2：/admin/endpoints 路由。
//
// v1 概念：endpoint 是协议、健康、能力、路由边界的一等对象。
// 本文件实现完整 CRUD + 按 endpoint 模型发现 + ping + reset defaults + reorder。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listEndpointsResponseSchema,
  endpointResponseSchema,
  createEndpointRequestSchema,
  updateEndpointRequestSchema,
  setEndpointEnabledRequestSchema,
  reorderEndpointsRequestSchema,
  resetEndpointDefaultsRequestSchema,
  resetEndpointDefaultsResponseSchema,
  pingEndpointRequestSchema,
  endpointHealthResponseSchema,
  discoverModelsResponseSchema,
  successEnvelope,
} from '@manageyourllm/contracts';
import { EndpointService } from '../../../application/endpoint.service.js';
import { ProbeService } from '../../../application/probe.service.js';
import { EndpointHealthWorker } from '../../../application/endpoint-health-worker.js';
import { EndpointHealthRepository } from '../../../infrastructure/db/repositories/endpoint-health.repository.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';
import type { EndpointRow } from '../../../infrastructure/db/schema.js';

export interface EndpointRouteDeps {
  db: Db;
  secretKey: string;
}

function toContract(row: EndpointRow) {
  return {
    id: row.id,
    providerAccountId: row.providerAccountId,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    path: row.path ?? null,
    providerType: row.providerType,
    defaultHeadersJson: row.defaultHeadersJson ?? null,
    extraHeadersJson: row.extraHeadersJson ?? null,
    extraParamsJson: row.extraParamsJson ?? null,
    capabilities: row.capabilitiesJson,
    enabled: row.enabled,
    displayOrder: row.displayOrder,
    isPresetDefault: row.isPresetDefault,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function endpointRoutes(app: FastifyInstance, deps: EndpointRouteDeps): Promise<void> {
  const service = new EndpointService(deps.db);
  const probe = new ProbeService({ db: deps.db, secretKey: deps.secretKey });
  const healthWorker = new EndpointHealthWorker({ db: deps.db, secretKey: deps.secretKey });
  const endpointHealthRepo = new EndpointHealthRepository(deps.db);

  // 列出 endpoint。query.providerAccountId 可选：不传则返回全量 endpoint，
  // 传了则返回该 provider account 下的 endpoint（v1 Phase 9 trace 过滤用）。
  app.get('/', async (req) => {
    const query = z.object({ providerAccountId: z.string().min(1).optional() }).parse(req.query);
    const rows = query.providerAccountId
      ? await service.listEndpointsForProviderAccount(query.providerAccountId)
      : await service.listAllEndpoints();
    return listEndpointsResponseSchema.parse({
      data: serializeForContract(rows.map(toContract)),
    });
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const row = await service.getEndpoint(id);
    if (!row) {
      return endpointResponseSchema.parse({ data: null });
    }
    return endpointResponseSchema.parse({
      data: serializeForContract(toContract(row)),
    });
  });

  app.post('/', async (req) => {
    const body = createEndpointRequestSchema.parse(req.body);
    const row = await service.createEndpoint(body);
    return endpointResponseSchema.parse({
      data: serializeForContract(toContract(row)),
    });
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = updateEndpointRequestSchema.parse(req.body);
    const row = await service.updateEndpoint(id, body);
    if (!row) {
      return endpointResponseSchema.parse({ data: null });
    }
    return endpointResponseSchema.parse({
      data: serializeForContract(toContract(row)),
    });
  });

  app.post('/:id/enable', async (req) => {
    const { id } = req.params as { id: string };
    const body = setEndpointEnabledRequestSchema.parse(req.body ?? {});
    const row = await service.setEndpointEnabled(id, body.enabled);
    if (!row) {
      return endpointResponseSchema.parse({ data: null });
    }
    return endpointResponseSchema.parse({
      data: serializeForContract(toContract(row)),
    });
  });

  app.post('/:id/disable', async (req) => {
    const { id } = req.params as { id: string };
    const body = setEndpointEnabledRequestSchema.parse(req.body ?? {});
    const row = await service.setEndpointEnabled(id, body.enabled);
    if (!row) {
      return endpointResponseSchema.parse({ data: null });
    }
    return endpointResponseSchema.parse({
      data: serializeForContract(toContract(row)),
    });
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await service.deleteEndpoint(id);
    return successEnvelope(z.object({ ok: z.boolean() })).parse({ data: { ok: true } });
  });

  app.post('/reset-defaults', async (req) => {
    const body = resetEndpointDefaultsRequestSchema.parse(req.body);
    const rows = await service.resetToPresetDefaults(body.providerAccountId);
    return resetEndpointDefaultsResponseSchema.parse({
      data: serializeForContract(rows.map(toContract)),
    });
  });

  app.post('/reorder', async (req) => {
    const body = reorderEndpointsRequestSchema.parse(req.body);
    await service.reorderEndpoints(body.items);
    return successEnvelope(z.object({ ok: z.boolean() })).parse({ data: { ok: true } });
  });

  // 模型发现：按指定 endpoint 拉 `/v1/models`
  app.post('/:id/discover', async (req) => {
    const { id } = req.params as { id: string };
    const row = await service.getEndpoint(id);
    if (!row) {
      return discoverModelsResponseSchema.parse({ data: [] });
    }
    const models = await probe.discoverModels({ endpointId: id });
    return discoverModelsResponseSchema.parse({ data: serializeForContract(models) });
  });

  // ping：按指定 endpoint
  app.post('/:id/ping', async (req) => {
    const { id } = req.params as { id: string };
    const body = pingEndpointRequestSchema.parse(req.body ?? {});
    const result = await probe.ping({ endpointId: id, model: body.model });
    await healthWorker.recordPingResult(id, result);
    return successEnvelope(
      z.object({ ok: z.boolean(), latencyMs: z.number(), error: z.string().nullable() }),
    ).parse({ data: result });
  });

  // 最新 health 查询：基于 endpoint_health 表
  app.get('/:id/health', async (req) => {
    const { id } = req.params as { id: string };
    const ep = await service.getEndpoint(id);
    if (!ep) {
      return endpointHealthResponseSchema.parse({ data: null });
    }
    const health = await endpointHealthRepo.findByEndpointId(ep.id);
    let status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown' = 'unknown';
    if (health) {
      if (!health.degraded) status = 'healthy';
      else if (health.errorCode === 'probe_failed') status = 'unhealthy';
      else status = 'degraded';
    }
    return endpointHealthResponseSchema.parse({
      data: serializeForContract({
        endpointId: ep.id,
        baseUrl: ep.baseUrl,
        status,
        latencyMs: health?.delayMs ?? null,
        errorCode: health?.errorCode ?? null,
        errorMessage: health?.errorMessage ?? null,
        lastCheckedAt: health?.lastCheckedAt ?? null,
      }),
    });
  });
}
