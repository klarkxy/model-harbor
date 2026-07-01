import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildServer, getBackgroundJobsHandle } from './server/build-server.js';
import { createEnv } from './config/env.js';

async function main(): Promise<void> {
  const env = createEnv();

  if (env.DATABASE_URL.startsWith('file:')) {
    const filePath = env.DATABASE_URL.slice('file:'.length);
    if (filePath !== ':memory:') {
      // 默认数据库路径已解析为项目根目录绝对路径；用户传入的相对路径仍由 libsql 按进程 cwd 解析。
      mkdirSync(dirname(filePath), { recursive: true });
    }
  }

  // 确保日志目录存在，避免 pino 打开文件失败。
  // 跳过 stdout/stderr 与特殊路径。
  if (
    env.LOG_FILE &&
    env.LOG_FILE !== '-' &&
    env.LOG_FILE !== '1' &&
    !env.LOG_FILE.startsWith('/dev/')
  ) {
    mkdirSync(dirname(env.LOG_FILE), { recursive: true });
  }

  const app = await buildServer();

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    app.log.info(`ManageYourLLM API listening on ${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async (): Promise<void> => {
    getBackgroundJobsHandle(app)?.stop();
    try {
      await app.close();
    } catch (err) {
      app.log.error(err);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
