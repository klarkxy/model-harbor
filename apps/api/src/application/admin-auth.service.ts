import type { Db } from '../infrastructure/db/client.js';
import { AdminUserRepository } from '../infrastructure/db/repositories/admin-user.repository.js';
import { hashPassword, verifyPassword } from '../domain/auth/password.js';
import {
  generateSessionId,
  issueSessionToken,
  verifySessionToken,
  hashSessionId,
} from '../domain/auth/session.js';
import { AuthenticationError } from '@manageyourllm/shared';
import type { AdminUserRow } from '../infrastructure/db/schema.js';

export interface AdminAuthDeps {
  db: Db;
  secretKey: string;
  sessionTtlMs?: number;
}

export interface LoginResult {
  admin: AdminUserRow;
  sessionToken: string;
  expiresAt: Date;
}

export class AdminAuthService {
  private readonly sessionTtlMs: number;

  constructor(private readonly deps: AdminAuthDeps) {
    this.sessionTtlMs = deps.sessionTtlMs ?? 24 * 60 * 60 * 1000;
  }

  private repo(): AdminUserRepository {
    return new AdminUserRepository(this.deps.db);
  }

  // 首次启动时创建管理员账号；若账号已存在则返回现有账号。
  async bootstrap(username: string, password: string, displayName?: string): Promise<AdminUserRow> {
    const existing = await this.repo().findByUsername(username);
    if (existing) return existing;
    return this.repo().createAdmin({
      username,
      passwordHash: hashPassword(password),
      displayName,
      enabled: true,
    });
  }

  async login(username: string, password: string, ip?: string): Promise<LoginResult> {
    const admin = await this.repo().findByUsername(username);
    if (!admin || !admin.enabled) {
      await this.recordAttempt(username, false, ip);
      throw new AuthenticationError('用户名或密码错误');
    }
    if (!verifyPassword(password, admin.passwordHash)) {
      await this.recordAttempt(username, false, ip);
      throw new AuthenticationError('用户名或密码错误');
    }

    await this.recordAttempt(username, true, ip);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
    const sessionId = generateSessionId();
    const sessionToken = issueSessionToken(sessionId, this.deps.secretKey);
    await this.repo().createSession({
      adminUserId: admin.id,
      sessionHash: hashSessionId(sessionId),
      expiresAt,
      lastSeenAt: now,
    });
    await this.repo().updateLastLogin(admin.id, now);
    return { admin, sessionToken, expiresAt };
  }

  async logout(sessionToken: string): Promise<void> {
    const sessionId = verifySessionToken(sessionToken, this.deps.secretKey);
    if (!sessionId) return;
    await this.repo().deleteSession(hashSessionId(sessionId));
  }

  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<AdminUserRow | undefined> {
    const admin = await this.repo().findById(adminId);
    if (!admin || !admin.enabled) {
      throw new AuthenticationError('管理员不存在或已禁用');
    }
    if (!verifyPassword(currentPassword, admin.passwordHash)) {
      throw new AuthenticationError('当前密码错误');
    }
    return this.repo().updateAdmin(adminId, {
      passwordHash: hashPassword(newPassword),
    });
  }

  private async recordAttempt(username: string, success: boolean, ip?: string): Promise<void> {
    await this.repo().insertLoginAttempt({ username, ip: ip ?? 'unknown', success });
  }
}
