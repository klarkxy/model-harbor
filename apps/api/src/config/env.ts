export interface Env {
  NODE_ENV: 'development' | 'production' | 'test';
  HOST: string;
  PORT: number;
  LOG_LEVEL: string;
  LOG_FILE: string;
  DATABASE_URL: string;
  SECRET_KEY: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  ADMIN_DISPLAY_NAME: string;
}

const DEFAULTS: Env = {
  NODE_ENV: 'development',
  HOST: '0.0.0.0',
  PORT: 3000,
  LOG_LEVEL: 'info',
  LOG_FILE: './logs/app.log',
  DATABASE_URL: 'file:./data/modelharbor.sqlite',
  SECRET_KEY: 'dev-secret-change-me',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'change-me-on-first-run',
  ADMIN_DISPLAY_NAME: 'Admin',
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
  return {
    NODE_ENV: nodeEnv,
    HOST: process.env['MODELHARBOR_HOST'] ?? DEFAULTS.HOST,
    PORT: readNumber('MODELHARBOR_PORT', DEFAULTS.PORT),
    LOG_LEVEL: process.env['MODELHARBOR_LOG_LEVEL'] ?? DEFAULTS.LOG_LEVEL,
    LOG_FILE: process.env['MODELHARBOR_LOG_FILE'] ?? DEFAULTS.LOG_FILE,
    DATABASE_URL: process.env['MODELHARBOR_DATABASE_URL'] ?? DEFAULTS.DATABASE_URL,
    SECRET_KEY: process.env['MODELHARBOR_SECRET_KEY'] ?? DEFAULTS.SECRET_KEY,
    ADMIN_USERNAME: process.env['MODELHARBOR_ADMIN_USERNAME'] ?? DEFAULTS.ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env['MODELHARBOR_ADMIN_PASSWORD'] ?? DEFAULTS.ADMIN_PASSWORD,
    ADMIN_DISPLAY_NAME:
      process.env['MODELHARBOR_ADMIN_DISPLAY_NAME'] ?? DEFAULTS.ADMIN_DISPLAY_NAME,
  };
}

let cached: Env | null = null;
export function createEnv(): Env {
  if (cached) return cached;
  cached = readEnv();
  if (cached.NODE_ENV === 'production') {
    if (cached.SECRET_KEY === DEFAULTS.SECRET_KEY) {
      throw new Error('MODELHARBOR_SECRET_KEY must be set in production');
    }
    if (cached.ADMIN_PASSWORD === DEFAULTS.ADMIN_PASSWORD) {
      throw new Error('MODELHARBOR_ADMIN_PASSWORD must be set in production');
    }
  }
  return cached;
}

export function resetEnvForTests(): void {
  cached = null;
}
