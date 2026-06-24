import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// scrypt 参数：现代服务器上约 50-100ms。
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_LEN = 16;
const KEY_LEN = 64;

// 生成密码哈希。格式：scrypt$N$r$p$base64salt$base64hash
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const derived = scryptSync(password.normalize('NFKC'), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

// 校验密码与存储的哈希是否匹配。
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltB64 = parts[4];
  const hashB64 = parts[5];
  if (!saltB64 || !hashB64) return false;
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = scryptSync(password.normalize('NFKC'), salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
