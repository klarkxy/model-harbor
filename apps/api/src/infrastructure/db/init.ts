import type { Db } from './client.js';
import { MIGRATIONS } from './migrations.js';
import { schemaMigrations } from './schema.js';

// 初始化 schema：先确保 schema_migrations 表存在，再按版本号顺序执行迁移。
export async function initSchema(db: Db): Promise<void> {
  await db.run(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );

  const rows = await db.select({ version: schemaMigrations.version }).from(schemaMigrations);
  const appliedVersions = new Set(rows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }
    for (const sql of migration.statements) {
      await db.run(sql);
    }
    await db.insert(schemaMigrations).values({
      version: migration.version,
      appliedAt: new Date(),
    });
  }
}

// 获取当前已应用的最高 schema 版本号。
export async function currentSchemaVersion(db: Db): Promise<number> {
  try {
    const rows = await db.select({ version: schemaMigrations.version }).from(schemaMigrations);
    return Math.max(0, ...rows.map((r) => r.version));
  } catch {
    return 0;
  }
}
