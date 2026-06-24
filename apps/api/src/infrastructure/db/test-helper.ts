import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type Db } from './client.js';
import { initSchema } from './init.js';

export interface TestDb {
  db: Db;
  client: ReturnType<typeof createDb>['client'];
  filePath: string;
  close(): Promise<void>;
}

// 创建隔离的临时文件数据库并初始化 schema。
// 使用文件而非 :memory:，因为 libsql 在 :memory: 模式下的 transaction 连接可能不共享 schema。
export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), 'myllm-test-'));
  const filePath = join(dir, 'test.sqlite');
  // 预创建空文件，确保 libsql 按文件模式打开。
  writeFileSync(filePath, Buffer.alloc(0));
  const { db, client } = createDb({ url: `file:${filePath}` });
  await initSchema(db);
  return {
    db,
    client,
    filePath,
    close: async () => {
      await client.close();
    },
  };
}

// 创建显式临时文件数据库，用于需要跨连接验证或备份还原的场景。
export async function createTestFileDb(): Promise<TestDb> {
  return createTestDb();
}
