import type { FastifyInstance } from 'fastify';
import {
  listPricingEntriesResponseSchema,
  pricingEntryResponseSchema,
  createPricingEntryRequestSchema,
  updatePricingEntryRequestSchema,
  successEnvelope,
} from '@manageyourllm/contracts';
import { z } from 'zod';
import { CostLedgerService } from '../../../domain/cost-ledger/cost-ledger.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';

export interface PricingRouteDeps {
  db: Db;
}

export async function pricingRoutes(app: FastifyInstance, deps: PricingRouteDeps): Promise<void> {
  const service = new CostLedgerService(deps.db);

  app.get('/', async () => {
    const entries = await service.listPricingEntries();
    return listPricingEntriesResponseSchema.parse({ data: serializeForContract(entries) });
  });

  app.post('/', async (req) => {
    const body = createPricingEntryRequestSchema.parse(req.body);
    const entry = await service.createPricingEntry({
      providerType: body.providerType as never,
      upstreamKeyId: body.upstreamKeyId ?? null,
      realModelName: body.realModelName,
      inputPricePer1k: body.inputPricePer1k,
      outputPricePer1k: body.outputPricePer1k,
      currency: body.currency,
      effectiveFrom: new Date(body.effectiveFrom),
      effectiveUntil: body.effectiveUntil ? new Date(body.effectiveUntil) : null,
    });
    return pricingEntryResponseSchema.parse({ data: serializeForContract(entry) });
  });

  app.put('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updatePricingEntryRequestSchema.parse(req.body);
    const entry = await service.updatePricingEntry(id, {
      ...body,
      providerType: body.providerType as never,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
      effectiveUntil: body.effectiveUntil === undefined ? undefined : body.effectiveUntil ? new Date(body.effectiveUntil) : null,
    });
    if (!entry) {
      return reply.status(404).send({
        error: { message: 'Pricing entry not found', type: 'not_found', code: 'pricing_entry_not_found' },
      });
    }
    return pricingEntryResponseSchema.parse({ data: serializeForContract(entry) });
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await service.deletePricingEntry(id);
    return successEnvelope(z.object({ ok: z.boolean() })).parse({ data: { ok: true } });
  });
}
