import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { AdminUserRepository } from '../../src/infrastructure/db/repositories/admin-user.repository.js';
import { hashPassword } from '../../src/domain/auth/password.js';
import { hashSessionId } from '../../src/domain/auth/session.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('admin user repository', () => {
  let testDb: TestDb;
  let repo: AdminUserRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new AdminUserRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('creates and finds admin by username', async () => {
    const created = await repo.createAdmin({
      username: 'admin',
      passwordHash: hashPassword('secret'),
      displayName: 'Admin',
      enabled: true,
    });
    const found = await repo.findByUsername('admin');
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.passwordHash).toBe(created.passwordHash);
  });

  it('creates session and finds by hash only when not expired', async () => {
    const admin = await repo.createAdmin({
      username: 'admin',
      passwordHash: hashPassword('secret'),
      enabled: true,
    });
    const sessionId = 'sess_test_123';
    const sessionHash = hashSessionId(sessionId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    await repo.createSession({
      adminUserId: admin.id,
      sessionHash,
      expiresAt,
      lastSeenAt: now,
    });
    const found = await repo.findSessionByHash(sessionHash);
    expect(found).toBeDefined();
    expect(found!.adminUserId).toBe(admin.id);
  });

  it('counts recent failed login attempts', async () => {
    await repo.insertLoginAttempt({ username: 'admin', ip: '127.0.0.1', success: false });
    await repo.insertLoginAttempt({ username: 'admin', ip: '127.0.0.1', success: false });
    await repo.insertLoginAttempt({ username: 'admin', ip: '127.0.0.1', success: true });
    const count = await repo.countRecentFailedAttempts(
      'admin',
      new Date(Date.now() - 60_000),
      '127.0.0.1',
    );
    expect(count).toBe(2);
  });
});
