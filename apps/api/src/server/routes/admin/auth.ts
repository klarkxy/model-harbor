import type { FastifyInstance } from 'fastify';
import {
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  logoutResponseSchema,
  changePasswordRequestSchema,
  changePasswordResponseSchema,
} from '@manageyourllm/contracts';
import { AdminAuthService } from '../../../application/admin-auth.service.js';
import type { AdminUserRow } from '../../../infrastructure/db/schema.js';
import type { Db } from '../../../infrastructure/db/client.js';

const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_DAYS = 1;

export interface AdminAuthRouteDeps {
  db: Db;
  secretKey: string;
  publicBaseUrl: string;
}

function isSecureBaseUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function stripAdmin(admin: AdminUserRow) {
  return {
    id: admin.id,
    username: admin.username,
    displayName: admin.displayName ?? '',
  };
}

export async function adminAuthRoutes(
  app: FastifyInstance,
  deps: AdminAuthRouteDeps,
): Promise<void> {
  const service = new AdminAuthService({ db: deps.db, secretKey: deps.secretKey });
  const secure = isSecureBaseUrl(deps.publicBaseUrl);

  app.post('/login', async (req, reply) => {
    const body = loginRequestSchema.parse(req.body);
    const result = await service.login(body.username, body.password, req.ip);
    reply.setCookie(SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: SESSION_MAX_AGE_DAYS * 24 * 60 * 60,
    });
    return loginResponseSchema.parse({ data: { admin: stripAdmin(result.admin) } });
  });

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      await service.logout(token);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure });
    return logoutResponseSchema.parse({ data: { ok: true } });
  });

  app.get('/me', async (req) => {
    const admin = req.admin as AdminUserRow | undefined;
    if (!admin) {
      return meResponseSchema.parse({ data: { admin: null } });
    }
    return meResponseSchema.parse({ data: { admin: stripAdmin(admin) } });
  });

  app.post('/change-password', async (req) => {
    const admin = req.admin as AdminUserRow | undefined;
    if (!admin) {
      // 由 guard 保证不会走到这里，保留类型安全。
      throw new Error('未登录');
    }
    const body = changePasswordRequestSchema.parse(req.body);
    const updated = await service.changePassword(admin.id, body.currentPassword, body.newPassword);
    return changePasswordResponseSchema.parse({ data: { admin: stripAdmin(updated!) } });
  });
}

// 类型辅助：让 Fastify 的 req 认识 admin 字段。
declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminUserRow;
  }
}
