import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { BackupRepository } from '../../src/infrastructure/db/repositories/backup.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('backup repository', () => {
  let testDb: TestDb;
  let repo: BackupRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new BackupRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('CRUD backup metadata', async () => {
    const backup = await repo.createBackup({
      filename: 'backup_2025.sqlite',
      type: 'full',
      sizeBytes: 1024,
      schemaVersion: 1,
      note: 'test backup',
    });
    expect(backup.filename).toBe('backup_2025.sqlite');

    const found = await repo.findById(backup.id);
    expect(found).toBeDefined();

    const list = await repo.listBackups('full');
    expect(list).toHaveLength(1);

    await repo.deleteBackup(backup.id);
    expect(await repo.findById(backup.id)).toBeUndefined();
  });
});
