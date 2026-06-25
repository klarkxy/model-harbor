import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { BackupService } from '../../src/domain/backup/backup.service.js';
import { AppRepository } from '../../src/infrastructure/db/repositories/app.repository.js';
import { createDb } from '../../src/infrastructure/db/client.js';

describe('backup service real restore', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let backupsDir: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    backupsDir = join(tmpdir(), `myllm-restore-${Date.now()}`);
  });

  afterEach(async () => {
    try {
      await testDb.close();
    } catch {
      // 恢复测试会主动关闭 client，此处忽略重复关闭错误。
    }
  });

  it('restores database file from a full backup', async () => {
    const service = new BackupService({
      db: testDb.db,
      client: testDb.client,
      dbFilePath: testDb.filePath,
      backupsDir,
    });

    // 创建备份（此时数据库中只有 schema，没有 app）。
    const backup = await service.createBackup('full', 'before app');

    // 在备份之后写入一条新数据。
    await new AppRepository(testDb.db).createApp({ name: 'after-backup', enabled: true });
    const appsBeforeRestore = await new AppRepository(testDb.db).listApps();
    expect(appsBeforeRestore.length).toBeGreaterThan(0);

    // 执行恢复：会关闭当前 client 并替换数据库文件。
    const restored = await service.restoreBackup(backup.id, true);
    expect(restored).toBe(true);

    // 用新连接打开恢复后的数据库，验证备份后的数据已消失。
    const { db: newDb, client: newClient } = createDb({ url: `file:${testDb.filePath}` });
    try {
      const appsAfterRestore = await new AppRepository(newDb).listApps();
      expect(appsAfterRestore).toHaveLength(0);
    } finally {
      await newClient.close();
    }
  });

  it('rejects restoring an invalid backup file', async () => {
    const service = new BackupService({
      db: testDb.db,
      client: testDb.client,
      dbFilePath: testDb.filePath,
      backupsDir,
    });

    const backup = await service.createBackup('full');

    // 用无效内容覆盖备份文件。
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(backupsDir, backup.filename), 'not a sqlite file');

    await expect(service.restoreBackup(backup.id, true)).rejects.toThrow(
      '备份文件不是有效的 SQLite 数据库',
    );
  });
});
