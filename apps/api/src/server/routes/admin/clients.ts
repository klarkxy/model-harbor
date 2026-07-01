// Phase 1 Slice 1 + Phase 6 收口：Client admin contract。
//
// v1 概念：一个 Client 一个 active key，不做权限、不做 client type。
// 资源结构：
// - `/`        Client CRUD
// - `/:id/key` Client 的 active key 管理（rotate / revoke / list）
//   - 不再提供独立 `/keys` 资源；key 不能跨 client 单独管理。
//   - 旧 `/admin/clients/keys/*` 在 Phase 6 收口后移除。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listClientsResponseSchema,
  clientResponseSchema,
  createClientRequestSchema,
  createClientResponseSchema,
  updateClientRequestSchema,
  listClientKeysResponseSchema,
  rotateClientKeyResponseSchema,
  revokeClientKeyResponseSchema,
  successEnvelope,
} from '@manageyourllm/contracts';
import { ClientService } from '../../../application/client.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import { clientKeyRowToContract } from '../../helpers/client-key-serializer.js';
import { notFound } from '../../helpers/errors.js';
import type { Db } from '../../../infrastructure/db/client.js';

export interface ClientRouteDeps {
  db: Db;
}

export async function clientRoutes(app: FastifyInstance, deps: ClientRouteDeps): Promise<void> {
  const service = new ClientService(deps.db);

  // ---- Client CRUD（`/`）----

  app.get('/', async () => {
    const clients = await service.listClients();
    return listClientsResponseSchema.parse({ data: serializeForContract(clients) });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await service.getClient(id);
    if (!item) {
      return notFound(reply, 'Client not found', 'client_not_found');
    }
    return clientResponseSchema.parse({ data: serializeForContract(item) });
  });

  app.post('/', async (req) => {
    const body = createClientRequestSchema.parse(req.body);
    const { client, rawKey } = await service.createClient({
      name: body.name,
      description: body.description ?? null,
      enabled: body.enabled ?? true,
    });
    return createClientResponseSchema.parse({
      data: { client: serializeForContract(client), rawKey },
    });
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = updateClientRequestSchema.parse(req.body);
    const item = await service.updateClient(id, {
      name: body.name,
      description: body.description ?? undefined,
      enabled: body.enabled,
    });
    return clientResponseSchema.parse({ data: serializeForContract(item) });
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await service.deleteClient(id);
    return successEnvelope(z.object({ ok: z.boolean() })).parse({ data: { ok: true } });
  });

  // ---- Client Active Key（`/:id/key`）----
  // v1 Phase 6 收口：以 clientId 为主键操作 active key，不再独立管理 key 列表。
  await app.register(
    async (subApp) => {
      subApp.get('/', async (req, reply) => {
        const { id: clientId } = req.params as { id: string };
        const client = await service.getClient(clientId);
        if (!client) {
          return notFound(reply, 'Client not found', 'client_not_found');
        }
        const keys = await service.listClientKeys(clientId);
        return listClientKeysResponseSchema.parse({
          data: keys.map(clientKeyRowToContract),
        });
      });

      subApp.post('/rotate', async (req, reply) => {
        const { id: clientId } = req.params as { id: string };
        const client = await service.getClient(clientId);
        if (!client) {
          return notFound(reply, 'Client not found', 'client_not_found');
        }
        const result = await service.rotateActiveKeyByClient(clientId);
        return rotateClientKeyResponseSchema.parse({
          data: {
            clientKey: clientKeyRowToContract(result.clientKey),
            rawKey: result.rawKey,
          },
        });
      });

      subApp.post('/revoke', async (req, reply) => {
        const { id: clientId } = req.params as { id: string };
        const client = await service.getClient(clientId);
        if (!client) {
          return notFound(reply, 'Client not found', 'client_not_found');
        }
        const revoked = await service.revokeActiveKeyByClient(clientId);
        return revokeClientKeyResponseSchema.parse({
          data: { clientKey: clientKeyRowToContract(revoked) },
        });
      });
    },
    { prefix: '/:id/key' },
  );
}
