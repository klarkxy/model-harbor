import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { AdminAuthService } from '../../src/application/admin-auth.service.js';
import { verifySessionToken } from '../../src/domain/auth/session.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('admin auth service', () => {
  let testDb: TestDb;
  let service: AdminAuthService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new AdminAuthService({ db: testDb.db, secretKey: 'test-secret-key' });
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('bootstraps admin and logs in', async () => {
    await service.bootstrap('admin', 'change-me');
    const result = await service.login('admin', 'change-me');
    expect(result.admin.username).toBe('admin');
    expect(verifySessionToken(result.sessionToken, 'test-secret-key')).toBeTruthy();
  });

  it('rejects wrong password', async () => {
    await service.bootstrap('admin', 'change-me');
    await expect(service.login('admin', 'wrong')).rejects.toThrow(/用户名或密码错误/);
  });

  it('changes password', async () => {
    const admin = await service.bootstrap('admin', 'old-password');
    const updated = await service.changePassword(admin.id, 'old-password', 'new-password');
    expect(updated).toBeDefined();
    await expect(service.login('admin', 'old-password')).rejects.toThrow();
    const result = await service.login('admin', 'new-password');
    expect(result.admin.id).toBe(admin.id);
  });
});
