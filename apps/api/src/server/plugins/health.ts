// 健康检查端点。
// `/healthz` 是存活探针——只要进程活着并且事件循环响应就返回 200。
// `/readyz` 是就绪探针——当服务器接入了数据库时，对数据库执行 SELECT 1；
// 如果数据库不可达则返回 503，负载均衡器可停止向该实例发流量。

import type { FastifyInstance } from 'fastify';

export interface HealthRouteDeps {
  db?: { get(query: string): Promise<unknown> };
}

export async function healthRoutes(
  app: FastifyInstance,
  deps: HealthRouteDeps = {},
): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_req, reply) => {
    if (!deps.db) {
      // Phase 0 尚未接入真实 DB；未传入 deps.db 时返回 ok。
      return { status: 'ok' };
    }
    try {
      await deps.db.get('SELECT 1');
      return { status: 'ok' };
    } catch (err) {
      reply.code(503);
      return {
        status: 'degraded',
        error: err instanceof Error ? err.message : 'unknown',
      };
    }
  });
}
