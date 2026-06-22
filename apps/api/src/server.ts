// Server bootstrap.
//
// `buildServer` always returns a `FastifyInstance`. The background jobs
// handle (when enabled) is attached as a non-enumerable property on the
// returned instance via the `BackgroundJobsSymbol` so `main.ts` can grab
// it for shutdown but tests can keep using the bare Fastify API (`.inject`,
// `.listen`, etc.) without unwrapping.

import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import pino from 'pino';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEnv } from './config/env.js';
import { healthRoutes } from './plugins/health.js';
import { registerErrorHandler } from './errors.js';
import { type Db } from './modules/db/index.js';
import { registerAdminAuthRoutes, requireAdmin } from './modules/auth/index.js';
import { registerGatewayRoutes } from './modules/gateway/index.js';
import {
  registerAppRoutes,
  registerAuditRoutes,
  registerConsumerKeyRoutes,
  registerModelGroupRoutes,
  registerModelReferenceRoutes,
  registerObservabilityRoutes,
  registerPublicModelRoutes,
  registerSettingsRoutes,
  registerUpstreamKeyRoutes,
  registerUpstreamOAuthRoutes,
} from './modules/admin/index.js';
import { startBackgroundJobs, type BackgroundJobsHandle } from './modules/jobs/index.js';
import { wrapLogger } from './modules/observability/index.js';

export const BackgroundJobsSymbol = Symbol.for('modelharbor.backgroundJobs');

export interface BuildServerOptions {
  logger?: boolean | FastifyServerOptions['logger'];
  db?: Db;
  secretKey?: string;
  isProduction?: boolean;
  // Disable the in-process background maintenance loop. Tests use this to
  // avoid surprises; production defaults to enabled.
  disableBackgroundJobs?: boolean;
  backgroundJobsIntervalMs?: number;
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
  const secretKey = options.secretKey ?? env.SECRET_KEY;
  const logger =
    options.logger !== undefined
      ? options.logger
      : (() => {
          // Tee pino's output to stdout (always) and to LOG_FILE (when set
          // to a real path). When LOG_FILE is "-" / "1" we treat it as a
          // sentinel meaning "stdout only" so dev/test can disable the file
          // sink via env without code changes.
          const pinoNs = pino as unknown as {
            destination: (opts: { dest: string; mkdir: boolean }) => NodeJS.WritableStream;
            multistream: (
              s: Array<{ level: string; stream: NodeJS.WritableStream }>,
            ) => NodeJS.WritableStream;
          };
          const streams: Array<{ level: string; stream: NodeJS.WritableStream }> = [
            { level: env.LOG_LEVEL, stream: process.stdout },
          ];
          if (env.LOG_FILE && env.LOG_FILE !== '-' && env.LOG_FILE !== '1') {
            streams.push({
              level: env.LOG_LEVEL,
              stream: pinoNs.destination({ dest: env.LOG_FILE, mkdir: false }),
            });
          }
          return {
            level: env.LOG_LEVEL,
            stream: pinoNs.multistream(streams),
          };
        })();

  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  const app = Fastify({ logger, trustProxy });

  // Wrap the app logger so structured fields that look like secrets (auth
  // headers, bearer tokens, mh_/sk- prefixed strings) are redacted before
  // they reach the underlying pino transport. The redaction walks objects
  // up to 6 levels deep.
  if (app.log) {
    const wrapped = wrapLogger(app.log);
    (app as unknown as { log: typeof wrapped }).log = wrapped;
  }

  // Fastify hands every request a `req.log` that is a child of `app.log`.
  // We replace it on the way in so any structured field a handler logs via
  // `req.log` is redacted too — otherwise request-scoped logs would bypass
  // the wrapped base logger entirely.
  app.addHook('onRequest', async (req) => {
    const requestLogger = (req as { log?: unknown }).log;
    if (requestLogger && typeof requestLogger === 'object') {
      (req as unknown as { log: unknown }).log = wrapLogger(
        requestLogger as Parameters<typeof wrapLogger>[0],
      );
    }
  });

  // Allow empty body when content-type is application/json (e.g. logout).
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
  await app.register(healthRoutes, { ...(options.db ? { db: options.db } : {}) });

  if (options.db) {
    registerAdminAuthRoutes(app, { db: options.db, secretKey, isProduction });
    // Guard everything under /api/admin except /api/admin/auth/*.
    const guard = requireAdmin(options.db, secretKey);
    app.addHook('preHandler', async (req, reply) => {
      const url = req.url;
      if (url.startsWith('/api/admin/') && !url.startsWith('/api/admin/auth/')) {
        await guard(req, reply);
      }
    });
    registerUpstreamKeyRoutes(app, { db: options.db, secretKey });
    registerUpstreamOAuthRoutes(app, { db: options.db, secretKey });
    registerPublicModelRoutes(app, { db: options.db });
    registerModelGroupRoutes(app, { db: options.db });
    registerModelReferenceRoutes(app, { db: options.db });
    registerAppRoutes(app, { db: options.db });
    registerConsumerKeyRoutes(app, { db: options.db });
    registerObservabilityRoutes(app, { db: options.db });
    registerSettingsRoutes(app, { db: options.db });
    registerAuditRoutes(app, { db: options.db });
    registerGatewayRoutes(app, { db: options.db, secretKey });

    // Serve built web assets in production, or in development when explicitly
    // requested (useful for single-port full-stack debugging).
    const serveWeb = isProduction || process.env['MODELHARBOR_SERVE_WEB'] === '1';
    if (serveWeb) {
      const staticRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
      await app.register(fastifyStatic, {
        root: staticRoot,
        prefix: '/',
        wildcard: false,
      });
      // SPA fallback: serve index.html for any non-API route
      app.setNotFoundHandler(async (req, reply) => {
        const url = req.url;
        if (
          url.startsWith('/api/') ||
          url.startsWith('/v1/') ||
          url.startsWith('/healthz') ||
          url.startsWith('/readyz')
        ) {
          reply.callNotFound();
          return;
        }
        await reply.sendFile('index.html', staticRoot);
      });
    }

    if (!options.disableBackgroundJobs) {
      const jobs = startBackgroundJobs(options.db, {
        intervalMs: options.backgroundJobsIntervalMs ?? 5 * 60 * 1000,
        secretKey,
      });
      (app as FastifyWithJobs)[BackgroundJobsSymbol] = jobs;
      app.addHook('onClose', async () => {
        jobs.stop();
      });
    }
  }

  return app;
}

/**
 * Translate the `MODELHARBOR_TRUST_PROXY` env value into the shape Fastify
 * expects on its `trustProxy` option.
 *
 *   ""        → false (trust nothing; direct bind only)
 *   "true"    → true  (trust every hop)
 *   "1" / "0" → boolean number
 *   "loopback" / "linklocal" / "uniquelocal" → preset string (Fastify
 *     passes these through to find-my-way)
 *   anything else is treated as a comma-separated CIDR / IP list.
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
