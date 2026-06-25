// Server bootstrap.
//
// `buildServer` 始终返回一个 `FastifyInstance`。后台任务句柄（如果启用）
// 通过 `BackgroundJobsSymbol` 作为不可枚举属性挂在返回的实例上，
// 以便 `main.ts` 在关闭时获取它，而测试可以继续使用裸 Fastify API。

import { existsSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { createEnv } from '../config/env.js';
import { registerErrorHandler } from './errors.js';
import { healthRoutes } from './plugins/health.js';
import { registerAdminAuthGuard } from './plugins/admin-auth.js';
import { adminRoutes } from './routes/admin/index.js';
import { gatewayRoutes } from './routes/gateway/index.js';
import { createDb, initSchema, type Db } from '../infrastructure/db/index.js';
import { AdminUserRepository } from '../infrastructure/db/repositories/admin-user.repository.js';
import { AdminAuthService } from '../application/admin-auth.service.js';
import { SettingsService } from '../domain/settings/settings.service.js';
import { EndpointHealthWorker } from '../application/endpoint-health-worker.js';
import { MaintenanceService } from '../application/maintenance.service.js';

export const BackgroundJobsSymbol = Symbol.for('manageyourllm.backgroundJobs');

export interface BuildServerOptions {
  logger?: boolean | FastifyServerOptions['logger'];
  isProduction?: boolean;
  // 禁用进程内后台维护循环。测试使用它避免意外。
  disableBackgroundJobs?: boolean;
  // 覆盖默认数据库 URL，测试使用 :memory: 避免文件 I/O。
  databaseUrl?: string;
  // 覆盖备份目录，测试使用临时目录避免污染工作区。
  backupsDir?: string;
  // 测试注入共享内存数据库连接。
  db?: Db;
  client?: Awaited<ReturnType<typeof createDb>>['client'];
}

export interface BackgroundJobsHandle {
  stop(): void;
}

export interface FastifyWithJobs extends FastifyInstance {
  [BackgroundJobsSymbol]?: BackgroundJobsHandle | null;
}

export function getBackgroundJobsHandle(app: FastifyInstance): BackgroundJobsHandle | null {
  return (app as FastifyWithJobs)[BackgroundJobsSymbol] ?? null;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const env = createEnv();
  const isProduction = options.isProduction ?? env.NODE_ENV === 'production';
  const logger = options.logger ?? { level: env.LOG_LEVEL };
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  const databaseUrl = options.databaseUrl ?? env.DATABASE_URL;
  const { db, client } =
    options.db && options.client
      ? { db: options.db, client: options.client }
      : createDb({ url: databaseUrl });

  // 计算数据库文件绝对路径供 backup service 使用。
  let dbFilePath = databaseUrl;
  if (databaseUrl.startsWith('file:')) {
    const rawPath = databaseUrl.slice('file:'.length);
    dbFilePath =
      rawPath === ':memory:' ? rawPath : isAbsolute(rawPath) ? rawPath : resolve(rawPath);
  }
  const backupsDir = options.backupsDir ?? './backups';
  await initSchema(db);
  const settings = await new SettingsService(db).getSettings();
  const gatewayBasePath = settings.gatewayBasePath ?? '/v1';

  // 首次启动时若没有任何管理员，则使用环境变量中的默认管理员账号自动创建。
  // 生产环境下 createEnv 会拒绝默认密码/secret，因此不会留下不安全的初始账号。
  const adminRepo = new AdminUserRepository(db);
  if (!(await adminRepo.hasAdmins())) {
    const authService = new AdminAuthService({ db, secretKey: env.SECRET_KEY });
    await authService.bootstrap(env.ADMIN_USERNAME, env.ADMIN_PASSWORD, env.ADMIN_DISPLAY_NAME);
  }

  const app = Fastify({ logger, trustProxy });

  // 允许 content-type 为 application/json 时 body 为空（例如 logout）。
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (typeof body === 'string' && body.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  registerErrorHandler(app);
  await app.register(fastifyCookie);
  registerAdminAuthGuard(app, { db, secretKey: env.SECRET_KEY });
  await app.register(adminRoutes, {
    prefix: '/api/admin',
    auth: { db, secretKey: env.SECRET_KEY, publicBaseUrl: env.PUBLIC_BASE_URL },
    setup: { db, secretKey: env.SECRET_KEY, publicBaseUrl: env.PUBLIC_BASE_URL },
    providerPresets: { db },
    upstreamKeys: { db, secretKey: env.SECRET_KEY },
    publicModels: { db },
    modelGroups: { db },
    apps: { db },
    consumerKeys: { db },
    backups: { db, client, dbFilePath, backupsDir },
    maintenance: { db },
    usage: { db },
    traces: { db },
    pricing: { db },
    plans: { db },
    settings: { db },
  });
  await app.register(gatewayRoutes, { prefix: gatewayBasePath, db, secretKey: env.SECRET_KEY });
  await app.register(healthRoutes, {
    db: {
      get: async (query: string) => client.execute(query),
    },
  });

  // 关闭服务器时同步关闭数据库连接。
  app.addHook('onClose', async () => {
    try {
      await client.close();
    } catch (err) {
      app.log.warn(err, '关闭数据库连接时出错');
    }
  });

  // 在生产模式或显式启用时，从同一端口提供构建后的前端资源，实现单端口部署。
  const staticRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'web', 'dist');
  const indexHtmlPath = join(staticRoot, 'index.html');
  if (isProduction && existsSync(staticRoot) && existsSync(indexHtmlPath)) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
      wildcard: false,
    });

    // SPA fallback：非 API/网关/健康检查路由返回 index.html。
    app.setNotFoundHandler(async (req, reply) => {
      const url = req.url;
      if (url.startsWith('/api/') || url.startsWith('/v1/') || url === '/v1') {
        return reply.status(404).send({
          error: { message: 'Not found', type: 'not_found', code: 'not_found' },
        });
      }
      if (url.startsWith('/healthz') || url.startsWith('/readyz')) {
        return reply.status(404).send({
          error: { message: 'Not found', type: 'not_found', code: 'not_found' },
        });
      }
      await reply.sendFile('index.html', staticRoot);
    });
  }

  // 启动后台任务：健康探测与维护清理。
  if (!options.disableBackgroundJobs) {
    const maintenanceService = new MaintenanceService({ db });
    const healthWorker = settings.endpointHealthProbeEnabled
      ? new EndpointHealthWorker({ db, secretKey: env.SECRET_KEY })
      : null;

    maintenanceService.start();
    healthWorker?.start(settings.endpointHealthProbeIntervalMs);

    const handle: BackgroundJobsHandle = {
      stop() {
        maintenanceService.stop();
        healthWorker?.stop();
      },
    };
    (app as FastifyWithJobs)[BackgroundJobsSymbol] = handle;
    app.addHook('onClose', async () => {
      handle.stop();
    });
  }

  // 静默忽略 favicon 请求，避免开发时 404 噪音。
  app.get('/favicon.ico', async (_req, reply) => reply.code(204).send());

  return app;
}

/**
 * 将 `MYLLM_TRUST_PROXY` / `MANAGE_YOUR_LLM_TRUST_PROXY` 的值转换为 Fastify
 * `trustProxy` 选项需要的形状。
 */
function parseTrustProxy(raw: string): boolean | number | string {
  const trimmed = raw.trim();
  if (trimmed === '') return false;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed.includes('/') || trimmed.includes('.')) return trimmed;
  return trimmed;
}
