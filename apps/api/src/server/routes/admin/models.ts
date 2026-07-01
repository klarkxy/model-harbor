import type { FastifyInstance } from 'fastify';
import {
  listModelsResponseSchema,
  modelResponseSchema,
  candidateResponseSchema,
  deleteCandidateResponseSchema,
  createModelRequestSchema,
  updateModelRequestSchema,
  addCandidateRequestSchema,
  updateCandidateRequestSchema,
  setCandidateEnabledRequestSchema,
  reorderCandidatesRequestSchema,
  successEnvelope,
} from '@manageyourllm/contracts';
import { ModelService } from '../../../application/model.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';
import { z } from 'zod';

export interface ModelRouteDeps {
  db: Db;
}

export async function modelRoutes(app: FastifyInstance, deps: ModelRouteDeps): Promise<void> {
  const service = new ModelService(deps.db);

  app.get('/', async () => {
    const models = await service.listModels();
    return listModelsResponseSchema.parse({ data: serializeForContract(models) });
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const model = await service.getModel(id);
    return modelResponseSchema.parse({ data: serializeForContract(model) });
  });

  app.post('/', async (req) => {
    const body = createModelRequestSchema.parse(req.body);
    const model = await service.createModel({
      name: body.name,
      displayName: body.displayName,
      description: body.description,
      enabled: body.enabled,
      candidates: body.candidates?.map((c) => ({
        ...c,
      })),
    });
    const withCandidates = await service.getModel(model.id);
    return modelResponseSchema.parse({ data: serializeForContract(withCandidates) });
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = updateModelRequestSchema.parse(req.body);
    const model = await service.updateModel(id, {
      name: body.name,
      displayName: body.displayName,
      description: body.description,
      enabled: body.enabled,
    });
    const withCandidates = await service.getModel(model!.id);
    return modelResponseSchema.parse({ data: serializeForContract(withCandidates) });
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await service.deleteModel(id);
    return successEnvelope(z.object({ ok: z.boolean() })).parse({ data: { ok: true } });
  });

  // --- 独立 candidate CRUD（v1 收口：逐 candidate 管理） ---

  app.post('/:id/candidates', async (req) => {
    const { id } = req.params as { id: string };
    const body = addCandidateRequestSchema.parse(req.body);
    const candidate = await service.addCandidate(id, body);
    return candidateResponseSchema.parse({ data: serializeForContract(candidate) });
  });

  app.patch('/candidates/:cid', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    const body = updateCandidateRequestSchema.parse(req.body);
    const candidate = await service.updateCandidate(cid, body);
    if (!candidate) {
      // 收口 #11：原本 `parse({ data: serializeForContract({}) })` 在 race-with-delete 时
      // 会因 zod 校验失败抛 ZodError → 500。这里直接返 404 + 结构化错误体。
      return reply.code(404).send({
        ok: false,
        error: { code: 'candidate_not_found', message: `candidate ${cid} 不存在` },
      });
    }
    return candidateResponseSchema.parse({ data: serializeForContract(candidate) });
  });

  app.post('/candidates/:cid/enable', async (req) => {
    const { cid } = req.params as { cid: string };
    const body = setCandidateEnabledRequestSchema.parse(req.body);
    const candidate = await service.setCandidateEnabled(cid, body.enabled);
    return candidateResponseSchema.parse({ data: serializeForContract(candidate) });
  });

  app.delete('/candidates/:cid', async (req) => {
    const { cid } = req.params as { cid: string };
    await service.deleteCandidate(cid);
    return deleteCandidateResponseSchema.parse({ data: { id: cid } });
  });

  app.post('/:id/candidates/reorder', async (req) => {
    const { id } = req.params as { id: string };
    const body = reorderCandidatesRequestSchema.parse(req.body);
    await service.reorderCandidates(
      id,
      body.map((item) => ({ candidateId: item.candidateId, priority: item.priority })),
    );
    const withCandidates = await service.getModel(id);
    return modelResponseSchema.parse({ data: serializeForContract(withCandidates) });
  });
}
