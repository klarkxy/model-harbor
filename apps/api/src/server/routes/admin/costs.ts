// Phase 1 Slice 1：Costs admin contract。
//
// 合并旧的 `pricing` 与 `plans` 为 `costs`。
// Costs 聚合两层资源：
// 1. 模型定价 (`/pricing`) —— 使用 CostLedgerService
// 2. 套餐账本 (`/plans`)   —— 使用 CostLedgerService
//
// Costs 不参与路由决策，仅做成本统计。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listPricingEntriesResponseSchema,
  pricingEntryResponseSchema,
  createPricingEntryRequestSchema,
  updatePricingEntryRequestSchema,
  listPlansResponseSchema,
  planResponseSchema,
  planRemindersResponseSchema,
  createPlanRequestSchema,
  updatePlanRequestSchema,
  successEnvelope,
} from '@manageyourllm/contracts';
import { CostLedgerService } from '../../../application/cost-ledger.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import { notFound } from '../../helpers/errors.js';
import type { Db } from '../../../infrastructure/db/client.js';
import type { ProviderType } from '@manageyourllm/shared';

export interface CostRouteDeps {
  db: Db;
}

function parseOptionalDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}

/**
 * 注册 `/admin/costs` 路由。
 *
 * 资源结构：
 * - `/pricing`        模型定价
 * - `/pricing/:id`    单条定价更新/删除
 * - `/plans`          套餐账本
 * - `/plans/reminders` 套餐到期提醒
 */
export async function costRoutes(app: FastifyInstance, deps: CostRouteDeps): Promise<void> {
  const service = new CostLedgerService(deps.db);

  // ---- 模型定价 (`/pricing`) ----

  await app.register(
    async (subApp) => {
      subApp.get('/', async () => {
        const entries = await service.listPricingEntries();
        return listPricingEntriesResponseSchema.parse({ data: serializeForContract(entries) });
      });

      subApp.post('/', async (req) => {
        const body = createPricingEntryRequestSchema.parse(req.body);
        const entry = await service.createPricingEntry({
          providerType: body.providerType as never,
          providerAccountId: body.providerAccountId ?? null,
          realModelName: body.realModelName,
          inputPricePer1k: body.inputPricePer1k,
          outputPricePer1k: body.outputPricePer1k,
          currency: body.currency,
          effectiveFrom: new Date(body.effectiveFrom),
          effectiveUntil: body.effectiveUntil ? new Date(body.effectiveUntil) : null,
        });
        return pricingEntryResponseSchema.parse({ data: serializeForContract(entry) });
      });

      subApp.put('/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const body = updatePricingEntryRequestSchema.parse(req.body);
        const entry = await service.updatePricingEntry(id, {
          ...body,
          providerType: body.providerType as never,
          effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
          effectiveUntil:
            body.effectiveUntil === undefined
              ? undefined
              : body.effectiveUntil
                ? new Date(body.effectiveUntil)
                : null,
        });
        if (!entry) {
          return notFound(reply, 'Pricing entry not found', 'pricing_entry_not_found');
        }
        return pricingEntryResponseSchema.parse({ data: serializeForContract(entry) });
      });

      subApp.delete('/:id', async (req) => {
        const { id } = req.params as { id: string };
        await service.deletePricingEntry(id);
        return successEnvelope(z.object({ ok: z.boolean() })).parse({ data: { ok: true } });
      });
    },
    { prefix: '/pricing' },
  );

  // ---- 套餐账本 (`/plans`) ----

  await app.register(
    async (subApp) => {
      subApp.get('/', async () => {
        const plans = await service.listPlans();
        return listPlansResponseSchema.parse({ data: serializeForContract(plans) });
      });

      subApp.get('/reminders', async () => {
        const reminders = await service.getPlanReminders();
        return planRemindersResponseSchema.parse({
          data: serializeForContract(reminders),
        });
      });

      subApp.post('/', async (req) => {
        const { providerAccountId, ...body } = createPlanRequestSchema.parse(req.body);
        const plan = await service.createPlan({
          ...body,
          providerType: (body.providerType as ProviderType) ?? null,
          providerAccountId: providerAccountId ?? null,
          notes: body.notes ?? null,
          purchasedAt: new Date(body.purchasedAt),
          validFrom: new Date(body.validFrom),
          validUntil: parseOptionalDate(body.validUntil) ?? null,
        });
        return planResponseSchema.parse({ data: serializeForContract(plan) });
      });

      subApp.put('/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const { providerAccountId, ...body } = updatePlanRequestSchema.parse(req.body);
        const plan = await service.updatePlan(id, {
          ...body,
          providerType:
            body.providerType === undefined ? undefined : (body.providerType as ProviderType),
          providerAccountId: providerAccountId === undefined ? undefined : providerAccountId,
          notes: body.notes === undefined ? undefined : body.notes,
          purchasedAt: body.purchasedAt ? new Date(body.purchasedAt) : undefined,
          validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
          validUntil: parseOptionalDate(body.validUntil),
        });
        if (!plan) {
          return notFound(reply, 'Plan not found', 'plan_not_found');
        }
        return planResponseSchema.parse({ data: serializeForContract(plan) });
      });

      subApp.delete('/:id', async (req) => {
        const { id } = req.params as { id: string };
        await service.deletePlan(id);
        return successEnvelope(z.object({ ok: z.boolean() })).parse({ data: { ok: true } });
      });
    },
    { prefix: '/plans' },
  );
}
