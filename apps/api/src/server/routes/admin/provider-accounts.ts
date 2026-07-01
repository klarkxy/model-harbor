// Phase 2 Slice 1：Provider Account admin contract。
//
// v1 概念统一为 Provider Account / Model / Channel / Client。
// 本文件直接用 `ProviderAccountService` + `ProviderAccountRepository`，
// 不再委托旧的 provider account 路由 handler。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listProviderAccountsResponseSchema,
  providerAccountResponseSchema,
  createProviderAccountRequestSchema,
  updateProviderAccountRequestSchema,
  rotateApiKeyRequestSchema,
  rotateApiKeyResponseSchema,
  reorderProviderAccountsRequestSchema,
  freezeProviderAccountRequestSchema,
  discoverModelsResponseSchema,
  pingProviderAccountRequestSchema,
  pingProviderAccountResponseSchema,
  successEnvelope,
} from '@manageyourllm/contracts';
import { ProviderAccountService } from '../../../application/provider-account.service.js';
import type { CreateProviderAccountInput } from '../../../application/provider-account.service.js';
import { ProbeService } from '../../../application/probe.service.js';
import { EndpointHealthWorker } from '../../../application/endpoint-health-worker.js';
import { ProviderAccountRepository } from '../../../infrastructure/db/repositories/provider-account.repository.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import { stripProviderAccountSecrets } from './provider-account-strip.js';
import type { Db } from '../../../infrastructure/db/client.js';
import type {
  ProviderAccountRow,
  ProviderAccountQuotaRow,
} from '../../../infrastructure/db/schema.js';

export interface ProviderAccountRouteDeps {
  db: Db;
  secretKey: string;
}

type ProviderAccountResponse = Omit<
  ProviderAccountRow,
  'apiKeyCiphertext' | 'authConfigCiphertext'
> & {
  quota?: ProviderAccountQuotaRow | null;
};

async function buildProviderAccountResponse(
  account: ProviderAccountRow,
  service: ProviderAccountService,
): Promise<ProviderAccountResponse> {
  const quota = await service.getQuotaByProviderAccount(account.id);
  return { ...stripProviderAccountSecrets(account), quota: quota ?? null };
}

/**
 * 注册 `/admin/provider-accounts` 路由。
 *
 * 直接持有 `ProviderAccountService` / `ProbeService` / `EndpointHealthWorker`，
 * 不再委托旧 provider account 路由。旧 contract `/admin/provider-accounts` 在
 * Phase 10 已收敛。
 */
export async function providerAccountRoutes(
  app: FastifyInstance,
  deps: ProviderAccountRouteDeps,
): Promise<void> {
  const service = new ProviderAccountService(deps.db, deps.secretKey);
  const repo = new ProviderAccountRepository(deps.db);
  const probe = new ProbeService({ db: deps.db, secretKey: deps.secretKey });
  const healthWorker = new EndpointHealthWorker({ db: deps.db, secretKey: deps.secretKey });

  app.get('/', async () => {
    const accounts = await service.listProviderAccounts();
    const withQuotas = await Promise.all(
      accounts.map((a) => buildProviderAccountResponse(a, service)),
    );
    return listProviderAccountsResponseSchema.parse({
      data: serializeForContract(withQuotas),
    });
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const account = await service.getProviderAccount(id);
    if (!account) {
      return providerAccountResponseSchema.parse({ data: null });
    }
    return providerAccountResponseSchema.parse({
      data: serializeForContract(await buildProviderAccountResponse(account, service)),
    });
  });

  app.post('/', async (req) => {
    const body = createProviderAccountRequestSchema.parse(req.body);
    const account = await service.createProviderAccount({
      ...body,
      providerType: body.providerType as Parameters<
        ProviderAccountService['createProviderAccount']
      >[0]['providerType'],
      endpoints: body.endpoints as CreateProviderAccountInput['endpoints'],
    });
    return providerAccountResponseSchema.parse({
      data: serializeForContract(await buildProviderAccountResponse(account, service)),
    });
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = updateProviderAccountRequestSchema.parse(req.body);
    const account = await service.updateProviderAccount(id, {
      ...body,
      providerType: body.providerType as
        | Parameters<ProviderAccountService['updateProviderAccount']>[1]['providerType']
        | undefined,
      endpoints: body.endpoints as CreateProviderAccountInput['endpoints'],
    });
    if (!account) {
      return providerAccountResponseSchema.parse({ data: null });
    }
    return providerAccountResponseSchema.parse({
      data: serializeForContract(await buildProviderAccountResponse(account, service)),
    });
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await service.deleteProviderAccount(id);
    return successEnvelope(z.object({ ok: z.boolean() })).parse({ data: { ok: true } });
  });

  app.post('/:id/rotate', async (req) => {
    const { id } = req.params as { id: string };
    const body = rotateApiKeyRequestSchema.parse(req.body);
    const account = await service.rotateApiKey(id, body.apiKey);
    if (!account) {
      return rotateApiKeyResponseSchema.parse({ data: null });
    }
    const safe = stripProviderAccountSecrets(account);
    return rotateApiKeyResponseSchema.parse({ data: serializeForContract(safe) });
  });

  app.post('/:id/freeze', async (req) => {
    const { id } = req.params as { id: string };
    const body = freezeProviderAccountRequestSchema.parse(req.body);
    const account = await service.freezeProviderAccount(id, body.frozen, body.reason);
    if (!account) {
      return providerAccountResponseSchema.parse({ data: null });
    }
    return providerAccountResponseSchema.parse({
      data: serializeForContract(await buildProviderAccountResponse(account, service)),
    });
  });

  app.post('/:id/unfreeze', async (req) => {
    const { id } = req.params as { id: string };
    const account = await service.freezeProviderAccount(id, false);
    if (!account) {
      return providerAccountResponseSchema.parse({ data: null });
    }
    return providerAccountResponseSchema.parse({
      data: serializeForContract(await buildProviderAccountResponse(account, service)),
    });
  });

  app.post('/reorder', async (req) => {
    const body = reorderProviderAccountsRequestSchema.parse(req.body);
    await service.reorderProviderAccounts(
      body.map((item) => ({ id: item.id, displayOrder: item.displayOrder })),
    );
    return successEnvelope(z.object({ ok: z.boolean() })).parse({ data: { ok: true } });
  });

  app.post('/:id/discover', async (req) => {
    const { id } = req.params as { id: string };
    const account = await repo.findById(id);
    if (!account) {
      return discoverModelsResponseSchema.parse({ data: [] });
    }
    const defaultEndpoint = await probe.pickDefaultEndpoint(account);
    if (!defaultEndpoint) {
      return discoverModelsResponseSchema.parse({ data: [] });
    }
    const models = await probe.discoverModels({ endpointId: defaultEndpoint.id });
    return discoverModelsResponseSchema.parse({ data: serializeForContract(models) });
  });

  app.post('/:id/ping', async (req) => {
    const { id } = req.params as { id: string };
    const body = pingProviderAccountRequestSchema.parse(req.body ?? {});
    const endpointId = body.endpointId;
    if (!endpointId) {
      const account = await repo.findById(id);
      if (!account) {
        return pingProviderAccountResponseSchema.parse({
          data: serializeForContract({ ok: false, latencyMs: 0, error: 'Provider Account 不存在' }),
        });
      }
      const defaultEndpoint = await probe.pickDefaultEndpoint(account);
      if (!defaultEndpoint) {
        return pingProviderAccountResponseSchema.parse({
          data: serializeForContract({ ok: false, latencyMs: 0, error: '无可用端点' }),
        });
      }
      const result = await probe.ping({ endpointId: defaultEndpoint.id, model: body.model });
      await healthWorker.recordPingResult(defaultEndpoint.id, result);
      return pingProviderAccountResponseSchema.parse({ data: serializeForContract(result) });
    }
    const result = await probe.ping({ endpointId, model: body.model });
    await healthWorker.recordPingResult(endpointId, result);
    return pingProviderAccountResponseSchema.parse({ data: serializeForContract(result) });
  });
}
