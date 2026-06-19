import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildServer, getBackgroundJobsHandle } from './server.js';
import { createDb, initSchema } from './modules/db/index.js';
import { bootstrapAdmin } from './modules/auth/index.js';
import { createEnv } from './config/env.js';

async function main(): Promise<void> {
  const env = createEnv();

  if (env.DATABASE_URL.startsWith('file:')) {
    const filePath = env.DATABASE_URL.slice('file:'.length);
    if (filePath !== ':memory:') {
      mkdirSync(dirname(filePath), { recursive: true });
    }
  }

  // Make sure the log directory exists before pino opens the file. We
  // skip this when LOG_FILE points at stdout (empty / "-" / "1").
  if (env.LOG_FILE && env.LOG_FILE !== '-' && env.LOG_FILE !== '1') {
    mkdirSync(dirname(env.LOG_FILE), { recursive: true });
  }

  const { db, client } = createDb({ url: env.DATABASE_URL });
  await initSchema(db);

  const admin = await bootstrapAdmin(db, {
    username: env.ADMIN_USERNAME,
    password: env.ADMIN_PASSWORD,
    displayName: env.ADMIN_DISPLAY_NAME,
  });
  console.log(`[modelharbor] admin user ready: ${admin.username} (${admin.id})`);

  const app = await buildServer({ db });

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (err) {
    app.log.error(err);
    client.close();
    process.exit(1);
  }

  const shutdown = async (): Promise<void> => {
    // Stop the background jobs loop first so it can't observe the db after
    // we close it. The Fastify onClose hook stops the loop too, but doing
    // it explicitly here makes the shutdown order easy to read.
    getBackgroundJobsHandle(app)?.stop();
    try {
      await app.close();
    } catch (err) {
      app.log.error(err);
    }
    client.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
