import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listPlansResponseSchema,
  planResponseSchema,
  createPlanRequestSchema,
  updatePlanRequestSchema,
  successEnvelope,
} from '@manageyourllm/contracts';
import { CostLedgerService } from '../../../domain/cost-ledger/cost-ledger.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';
import type { ProviderType } from '@manageyourllm/shared';

export interface PlanRouteDeps {
  db: Db;
}

function parseOptionalDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}

export async function planRoutes(app: FastifyInstance, deps: PlanRouteDeps): Promise<void> {
  const service = new CostLedgerService(deps.db);

  app.get('/', async () => {
    const plans = await service.listPlans();
    return listPlansResponseSchema.parse({ data: serializeForContract(plans) });
  });

  app.post('/', async (req) => {
    const body = createPlanRequestSchema.parse(req.body);
    const plan = await service.createPlan({
      ...body,
      providerType: (body.providerType as ProviderType) ?? null,
      upstreamKeyId: body.upstreamKeyId ?? null,
      notes: body.notes ?? null,
      purchasedAt: new Date(body.purchasedAt),
      validFrom: new Date(body.validFrom),
      validUntil: parseOptionalDate(body.validUntil) ?? null,
    });
    return planResponseSchema.parse({ data: serializeForContract(plan) });
  });

  app.put('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updatePlanRequestSchema.parse(req.body);
    const plan = await service.updatePlan(id, {
      ...body,
      providerType: body.providerType === undefined ? undefined : (body.providerType as ProviderType),
      upstreamKeyId: body.upstreamKeyId === undefined ? undefined : body.upstreamKeyId,
      notes: body.notes === undefined ? undefined : body.notes,
      purchasedAt: body.purchasedAt ? new Date(body.purchasedAt) : undefined,
      validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
      validUntil: parseOptionalDate(body.validUntil),
    });
    if (!plan) {
      return reply.status(404).send({
        error: { message: 'Plan not found', type: 'not_found', code: 'plan_not_found' },
      });
    }
    return planResponseSchema.parse({ data: serializeForContract(plan) });
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await service.deletePlan(id);
    return successEnvelope(z.object({ ok: z.boolean() })).parse({ data: { ok: true } });
  });
}
