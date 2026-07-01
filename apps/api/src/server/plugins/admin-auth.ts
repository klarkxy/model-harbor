import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifySessionToken, hashSessionId } from '../../domain/auth/session.js';
import { AdminUserRepository } from '../../infrastructure/db/repositories/admin-user.repository.js';
import { AuthenticationError } from '@manageyourllm/shared';
import type { Db } from '../../infrastructure/db/client.js';

const SESSION_COOKIE = 'session';
const PUBLIC_ADMIN_PATHS = ['/api/admin/auth/login', '/api/admin/auth/logout'];
const PUBLIC_ADMIN_PREFIXES = ['/api/admin/setup/'];

export interface AdminAuthPluginDeps {
  db: Db;
  secretKey: string;
}

function isPublicAdminPath(url: string): boolean {
  if (PUBLIC_ADMIN_PATHS.some((path) => url === path || url.startsWith(`${path}?`))) {
    return true;
  }
  return PUBLIC_ADMIN_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export async function adminAuthGuardHook(
  req: FastifyRequest,
  _reply: unknown,
  deps: AdminAuthPluginDeps,
): Promise<void> {
  const url = req.raw.url ?? req.url;
  if (!url.startsWith('/api/admin/')) return;
  if (isPublicAdminPath(url)) return;

  const token = req.cookies[SESSION_COOKIE];
  if (!token) {
    throw new AuthenticationError('未登录');
  }

  const sessionId = verifySessionToken(token, deps.secretKey);
  if (!sessionId) {
    throw new AuthenticationError('会话无效');
  }

  const repo = new AdminUserRepository(deps.db);
  const session = await repo.findSessionByHash(hashSessionId(sessionId));
  if (!session) {
    throw new AuthenticationError('会话已失效或过期');
  }

  const admin = await repo.findById(session.adminUserId);
  if (!admin || !admin.enabled) {
    throw new AuthenticationError('管理员不存在或已禁用');
  }

  await repo.touchSession(session.sessionHash);
  req.admin = admin;
}

export async function adminAuthPlugin(
  app: FastifyInstance,
  deps: AdminAuthPluginDeps,
): Promise<void> {
  app.addHook('preHandler', async (req) => adminAuthGuardHook(req, undefined, deps));
}

export function registerAdminAuthGuard(app: FastifyInstance, deps: AdminAuthPluginDeps): void {
  app.addHook('preHandler', async (req) => adminAuthGuardHook(req, undefined, deps));
}
