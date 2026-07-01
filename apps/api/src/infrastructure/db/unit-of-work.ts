import type { Db } from './client.js';

// 事务回调签名。Drizzle 的 transaction tx 与 db 在运行时的查询接口一致，
// 但类型上 tx 是 LibSQLTransaction。wrapper 内部将其断言为 Db，使 repository
// 不需要同时接受 db / tx 两种类型。该断言仅在 repository 仅使用标准 CRUD
// 方法时安全；调用 Drizzle 专属事务 API 时请直接使用 tx。
export type TransactionFn<T> = (tx: Db) => Promise<T>;

// 在事务中执行 fn；失败自动回滚，成功自动提交。
export async function withTransaction<T>(db: Db, fn: TransactionFn<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx as unknown as Db));
}
