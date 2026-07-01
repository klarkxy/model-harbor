import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const projectRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const defaultDatabaseUrl = `file:${resolve(projectRoot, 'data', 'manageyourllm.sqlite')}`;
const defaultLogFile = resolve(projectRoot, 'logs', 'app.log');

export interface Env {
  NODE_ENV: 'development' | 'production' | 'test';
  HOST: string;
  PORT: number;
  LOG_LEVEL: string;
  LOG_FILE: string;
  DATABASE_URL: string;
  SECRET_KEY: string;
  /**
   * 转发给 Fastify 的 `trustProxy` 选项。空字符串表示
   * "不信任任何上游 hop"（默认，直接绑定时最安全）。
   * 示例：
   *   "loopback"  — 信任 127.0.0.1, ::1, ::ffff:127.0.0.1
   *   "linklocal" — 信任 169.254.0.0/16
   *   "uniquelocal" — 信任 10/8, 172.16/12, 192.168/16, fc00::/7
   *   "true"      — 信任所有 hop（仅在已知反代后使用）
   *   "1"         — 数字形式，信任第一个 hop
   *   "10.0.0.0/8,192.168.0.0/16" — 逗号分隔的 CIDR 列表
   */
  TRUST_PROXY: string;
  /**
   * 服务对外可访问的 base URL，用于在 UI 中展示绝对端点 URL。
   * 为空时回退到 `http://localhost:${PORT}`，方便本地开发无需配置。
   * 在反向代理后运行时应设置为公开 host，例如 `https://llm.example.com`。
   */
  PUBLIC_BASE_URL: string;
}

const DEFAULTS: Env = {
  NODE_ENV: 'development',
  HOST: '0.0.0.0',
  PORT: 5420,
  LOG_LEVEL: 'info',
  LOG_FILE: defaultLogFile,
  DATABASE_URL: defaultDatabaseUrl,
  SECRET_KEY: 'dev-secret-change-me',
  TRUST_PROXY: '',
  PUBLIC_BASE_URL: '',
};

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number for env ${name}: ${raw}`);
  }
  return n;
}

function readEnv(): Env {
  const nodeEnvRaw = (process.env['NODE_ENV'] ?? DEFAULTS.NODE_ENV) as Env['NODE_ENV'];
  const nodeEnv: Env['NODE_ENV'] = ['development', 'production', 'test'].includes(nodeEnvRaw)
    ? nodeEnvRaw
    : 'development';
  const port = readNumber('MYLLM_PORT', readNumber('MANAGE_YOUR_LLM_PORT', DEFAULTS.PORT));
  const rawBaseUrl =
    process.env['MYLLM_PUBLIC_BASE_URL'] ??
    process.env['MANAGE_YOUR_LLM_PUBLIC_BASE_URL'] ??
    DEFAULTS.PUBLIC_BASE_URL;
  const resolvedBaseUrl =
    rawBaseUrl.trim().length > 0 ? rawBaseUrl.trim() : `http://localhost:${port}`;

  function envString(name: string, fallback: string): string {
    return process.env[name] ?? fallback;
  }

  return {
    NODE_ENV: nodeEnv,
    HOST: envString('MYLLM_HOST', envString('MANAGE_YOUR_LLM_HOST', DEFAULTS.HOST)),
    PORT: port,
    LOG_LEVEL: envString(
      'MYLLM_LOG_LEVEL',
      envString('MANAGE_YOUR_LLM_LOG_LEVEL', DEFAULTS.LOG_LEVEL),
    ),
    LOG_FILE: envString('MYLLM_LOG_FILE', envString('MANAGE_YOUR_LLM_LOG_FILE', DEFAULTS.LOG_FILE)),
    DATABASE_URL: envString(
      'MYLLM_DATABASE_URL',
      envString('MANAGE_YOUR_LLM_DATABASE_URL', DEFAULTS.DATABASE_URL),
    ),
    SECRET_KEY: envString(
      'MYLLM_SECRET_KEY',
      envString('MANAGE_YOUR_LLM_SECRET_KEY', DEFAULTS.SECRET_KEY),
    ),
    TRUST_PROXY: envString(
      'MYLLM_TRUST_PROXY',
      envString('MANAGE_YOUR_LLM_TRUST_PROXY', DEFAULTS.TRUST_PROXY),
    ),
    PUBLIC_BASE_URL: resolvedBaseUrl,
  };
}

let cached: Env | null = null;
export function createEnv(): Env {
  if (cached) return cached;
  cached = readEnv();
  if (cached.NODE_ENV === 'production') {
    if (cached.SECRET_KEY === DEFAULTS.SECRET_KEY) {
      throw new Error('MYLLM_SECRET_KEY / MANAGE_YOUR_LLM_SECRET_KEY must be set in production');
    }
  }
  return cached;
}

export function resetEnvForTests(): void {
  cached = null;
}

/**
 * 返回去除尾部 `/` 的对外 base URL，方便调用者拼接 `${baseUrl}${basePath}/...`。
 */
export function getPublicBaseUrl(env: Env): string {
  return env.PUBLIC_BASE_URL.replace(/\/+$/, '');
}
