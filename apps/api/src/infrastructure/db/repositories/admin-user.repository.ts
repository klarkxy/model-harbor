import { eq, and, gt, lt, count } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  adminUsers,
  adminSessions,
  loginAttempts,
  type AdminUserInsert,
  type AdminUserRow,
  type AdminSessionInsert,
  type AdminSessionRow,
  type LoginAttemptInsert,
  type LoginAttemptRow,
} from '../schema.js';

export class AdminUserRepository {
  constructor(private readonly db: Db) {}

  async createAdmin(
    data: Omit<AdminUserInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<AdminUserRow> {
    const now = new Date();
    const row: AdminUserInsert = {
      id: generateId('admin'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(adminUsers).values(row);
    return row as AdminUserRow;
  }

  async findById(id: string): Promise<AdminUserRow | undefined> {
    const rows = await this.db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    return rows[0];
  }

  async findByUsername(username: string): Promise<AdminUserRow | undefined> {
    const rows = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.username, username))
      .limit(1);
    return rows[0];
  }

  async updateAdmin(
    id: string,
    data: Partial<Omit<AdminUserInsert, 'id' | 'createdAt'>>,
  ): Promise<AdminUserRow | undefined> {
    const now = new Date();
    await this.db
      .update(adminUsers)
      .set({ ...data, updatedAt: now })
      .where(eq(adminUsers.id, id));
    return this.findById(id);
  }

  async updateLastLogin(id: string, at = new Date()): Promise<void> {
    await this.db
      .update(adminUsers)
      .set({ lastLoginAt: at, updatedAt: at })
      .where(eq(adminUsers.id, id));
  }

  // --- Session ---

  async createSession(
    data: Omit<AdminSessionInsert, 'id' | 'createdAt'>,
  ): Promise<AdminSessionRow> {
    const now = new Date();
    const row: AdminSessionInsert = {
      id: generateId('session'),
      ...data,
      createdAt: now,
    };
    await this.db.insert(adminSessions).values(row);
    return row as AdminSessionRow;
  }

  async findSessionByHash(sessionHash: string): Promise<AdminSessionRow | undefined> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(adminSessions)
      .where(and(eq(adminSessions.sessionHash, sessionHash), gt(adminSessions.expiresAt, now)))
      .limit(1);
    return rows[0];
  }

  async touchSession(sessionHash: string, at = new Date()): Promise<void> {
    await this.db
      .update(adminSessions)
      .set({ lastSeenAt: at })
      .where(eq(adminSessions.sessionHash, sessionHash));
  }

  async deleteSession(sessionHash: string): Promise<void> {
    await this.db.delete(adminSessions).where(eq(adminSessions.sessionHash, sessionHash));
  }

  async deleteExpiredSessions(at = new Date()): Promise<void> {
    await this.db.delete(adminSessions).where(lt(adminSessions.expiresAt, at));
  }

  // --- Login attempts ---

  async insertLoginAttempt(
    data: Omit<LoginAttemptInsert, 'id' | 'createdAt'>,
  ): Promise<LoginAttemptRow> {
    const now = new Date();
    const row: LoginAttemptInsert = {
      id: generateId('loginAttempt'),
      ...data,
      createdAt: now,
    };
    await this.db.insert(loginAttempts).values(row);
    return row as LoginAttemptRow;
  }

  async countRecentFailedAttempts(username: string, since: Date, ip?: string): Promise<number> {
    const conditions = [
      eq(loginAttempts.username, username),
      eq(loginAttempts.success, false),
      gt(loginAttempts.createdAt, since),
    ];
    if (ip !== undefined) {
      conditions.push(eq(loginAttempts.ip, ip));
    }
    const rows = await this.db
      .select({ total: count() })
      .from(loginAttempts)
      .where(and(...conditions));
    return rows[0]?.total ?? 0;
  }
}
