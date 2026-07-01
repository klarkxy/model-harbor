import type { FastifyInstance, FastifyRequest } from 'fastify';
import { generateId } from '@manageyourllm/shared';
import { AuthenticationError } from '@manageyourllm/shared';
import { ClientService } from '../../application/client.service.js';
import type { Db } from '../../infrastructure/db/client.js';

export interface GatewayAuthPluginDeps {
  db: Db;
}

function extractBearerToken(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function extractRawKey(req: FastifyRequest): string | undefined {
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];
  return (
    extractBearerToken(authHeader) ?? (typeof apiKeyHeader === 'string' ? apiKeyHeader : undefined)
  );
}

export async function gatewayAuthGuardHook(
  req: FastifyRequest,
  _reply: unknown,
  deps: GatewayAuthPluginDeps,
): Promise<void> {
  const rawKey = extractRawKey(req);
  if (!rawKey) {
    throw new AuthenticationError('缺少 client key');
  }

  const clientService = new ClientService(deps.db);
  const clientKey = await clientService.verifyRawKey(rawKey);
  if (!clientKey) {
    throw new AuthenticationError('无效的 client key');
  }
  if (!clientKey.enabled) {
    throw new AuthenticationError('client key 已禁用');
  }
  if (clientKey.revokedAt) {
    throw new AuthenticationError('client key 已吊销');
  }

  const client = await clientService.getClient(clientKey.clientId);
  if (!client || !client.enabled) {
    throw new AuthenticationError('客户端已禁用');
  }

  req.clientKey = clientKey;
  req.client = client;
  req.requestTraceId = generateId('trace');
  req.requestStartTime = Date.now();
}

export async function gatewayAuthPlugin(
  app: FastifyInstance,
  deps: GatewayAuthPluginDeps,
): Promise<void> {
  app.addHook('preHandler', async (req) => gatewayAuthGuardHook(req, undefined, deps));
}

export function registerGatewayAuthGuard(app: FastifyInstance, deps: GatewayAuthPluginDeps): void {
  app.addHook('preHandler', async (req) => gatewayAuthGuardHook(req, undefined, deps));
}
