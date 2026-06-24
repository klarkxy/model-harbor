import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import * as schema from './schema.js';

// 数据库连接类型，供 repository 与 service 使用。
export type Db = LibSQLDatabase<typeof schema>;

export interface CreateDbOptions {
  url: string;
  authToken?: string;
}

// 创建 Drizzle + libsql 客户端。
export function createDb(options: CreateDbOptions): { db: Db; client: Client } {
  const client = createClient({
    url: options.url,
    ...(options.authToken !== undefined ? { authToken: options.authToken } : {}),
  });
  const db = drizzle(client, { schema });
  return { db, client };
}
