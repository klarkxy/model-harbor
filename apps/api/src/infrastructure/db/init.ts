import type { Db } from './client.js';
import { MIGRATIONS } from './migrations.js';
import {
  schemaMigrations,
  targetNames,
  usageRecords,
  modelCandidates,
  endpoints,
} from './schema.js';
import { sql, inArray, isNull, and } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';

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

  // v11 之后的应用层 backfill：处理"多 endpoint 拆行"与"endpoint_id 仍为 NULL 的 0 endpoint 情况"。
  // 必须在 MIGRATIONS 全部执行后调用，因为它会读 model_candidates / endpoints 当前真实数据。
  await backfillCandidateEndpointId(db);

  // Phase 4 收尾：libsql 不支持 `DROP COLUMN IF EXISTS`，用 PRAGMA 判断后显式删除。
  await dropColumnIfExists(db, 'admin_settings', 'public_endpoints_base_path');
  await dropColumnIfExists(db, 'models', 'candidate_order_customized');
}

async function dropColumnIfExists(db: Db, table: string, column: string): Promise<void> {
  const rows = await db.all(sql.raw(`PRAGMA table_info('${table}')`));
  if (rows.some((r) => (r as { name: string }).name === column)) {
    await db.run(sql.raw(`ALTER TABLE "${table}" DROP COLUMN "${column}"`));
  }
}

// v11 candidate endpointId 化收口。
// SQL migration 已经处理了"单 endpoint"的情况；这里负责：
//   1. endpoint_id 仍为 NULL 的 candidate 行 → 该 provider_account 下有 0 个 endpoint，抛错拒启动。
//   2. 多 endpoint 的 candidate → 拆成 N 行（每行绑定一个 endpoint），priority / enabled 沿用原值。
//      旧 id 保留给"第一个 endpoint"，后续 endpoint 分配新 id。
//   3. 拆行后清理：保证每行 candidate 都有非空 endpoint_id。
//   4. 拆行后做 final check：所有 candidate 都有 endpoint_id + endpoint 必须属于 candidate.providerAccountId。
export async function backfillCandidateEndpointId(db: Db): Promise<void> {
  // 只处理 endpoint_id 为 NULL 的行。SQL migration 已经把"单 endpoint"情况填好了。
  const pending = await db
    .select({
      id: modelCandidates.id,
      modelId: modelCandidates.modelId,
      providerAccountId: modelCandidates.providerAccountId,
      realModelName: modelCandidates.realModelName,
      priority: modelCandidates.priority,
      enabled: modelCandidates.enabled,
      endpointUrl: modelCandidates.endpointUrl,
      createdAt: modelCandidates.createdAt,
      updatedAt: modelCandidates.updatedAt,
    })
    .from(modelCandidates)
    .where(sql`${modelCandidates.endpointId} IS NULL`);

  if (pending.length === 0) {
    return;
  }

  // 按 providerAccountId 分组查 endpoint 列表。
  const accountIds = Array.from(new Set(pending.map((p) => p.providerAccountId)));
  const endpointRows = await db
    .select({
      id: endpoints.id,
      providerAccountId: endpoints.providerAccountId,
      displayOrder: endpoints.displayOrder,
    })
    .from(endpoints)
    .where(inArray(endpoints.providerAccountId, accountIds))
    .orderBy(endpoints.displayOrder, endpoints.id);

  const byAccount = new Map<string, typeof endpointRows>();
  for (const ep of endpointRows) {
    const list = byAccount.get(ep.providerAccountId) ?? [];
    list.push(ep);
    byAccount.set(ep.providerAccountId, list);
  }

  // 检查哪些行无 endpoint —— 直接抛错。
  const orphans: string[] = [];
  for (const row of pending) {
    const eps = byAccount.get(row.providerAccountId) ?? [];
    if (eps.length === 0) {
      orphans.push(row.id);
    }
  }
  if (orphans.length > 0) {
    throw new Error(
      `v11 candidate endpointId 化失败：以下 ${orphans.length} 条 candidate 所属 provider_account 下没有 endpoint：` +
        `id=${orphans.slice(0, 5).join(',')}${orphans.length > 5 ? '...' : ''}。` +
        `请先为对应 provider_account 创建至少一个 endpoint，再启动服务。`,
    );
  }

  // 多 endpoint 拆行：保留第一行原 id（FK 引用稳定），其余行用新 id。
  // 拆行后用 SQL UPDATE 把 endpoint_id 填上。
  const now = new Date();
  for (const row of pending) {
    const eps = byAccount.get(row.providerAccountId) ?? [];
    if (eps.length === 1) {
      // 1 endpoint：SQL migration 漏掉了？显式补一次。
      const ep = eps[0]!;
      await db
        .update(modelCandidates)
        .set({ endpointId: ep.id, updatedAt: now })
        .where(sql`${modelCandidates.id} = ${row.id}`);
      continue;
    }
    // 多 endpoint：拆成 N 行。先 INSERT 额外行，再 UPDATE 原行，
    // 确保崩溃时可重入（原行 endpoint_id 仍为 NULL 则下次重试时重新处理）。
    const [first, ...rest] = eps;
    if (!first) continue;
    for (const ep of rest) {
      await db.insert(modelCandidates).values({
        id: generateId('modelCandidate'),
        modelId: row.modelId,
        providerAccountId: row.providerAccountId,
        endpointId: ep.id,
        realModelName: row.realModelName,
        enabled: row.enabled,
        priority: row.priority,
        endpointUrl: row.endpointUrl,
        createdAt: row.createdAt,
        updatedAt: now,
      });
    }
    // 最后标记原行完成（只有仍为 NULL 才处理，避免重试时重复覆盖）。
    await db
      .update(modelCandidates)
      .set({ endpointId: first.id, updatedAt: now })
      .where(and(sql`${modelCandidates.id} = ${row.id}`, isNull(modelCandidates.endpointId)));
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

// v10 之后的应用层 boot check：
// - SQLite 的 RAISE() 只允许在 trigger-program 内使用，无法在 migration 里断言。
// - initSchema 完成后，调用此函数校验 target_type / resolved_target_type 数据
//   已全部收敛到 v1 枚举值（'model' / 'channel'）。若存在旧值，直接拒绝启动。
export async function assertV1TargetTypeEnum(db: Db): Promise<void> {
  const allowed = sql`('model', 'channel')`;
  const checks: Array<{ table: string; count: number }> = [];

  const [t1] = await db
    .select({ count: sql<number>`count(*)` })
    .from(targetNames)
    .where(sql`${targetNames.targetType} NOT IN ${allowed}`);
  if (t1) checks.push({ table: 'target_names', count: Number(t1.count) });

  const [t3] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usageRecords)
    .where(sql`${usageRecords.resolvedTargetType} NOT IN ${allowed}`);
  if (t3) checks.push({ table: 'usage_records', count: Number(t3.count) });

  const violations = checks.filter((c) => c.count > 0);
  if (violations.length > 0) {
    const detail = violations.map((c) => `${c.table}=${c.count}`).join(', ');
    throw new Error(
      `v1 target_type 枚举值不收敛：${detail}。` +
        `这通常是 v10 migration 之后又写入了旧值('public_model' / 'model_group')，` +
        `请检查代码路径或重建数据库。`,
    );
  }
}
