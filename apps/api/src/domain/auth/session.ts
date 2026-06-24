import { createHmac, createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';

const SEP = '.';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

// 签发 session token：sessionId + HMAC 签名。
export function issueSessionToken(sessionId: string, secret: string): string {
  return `${sessionId}${SEP}${sign(sessionId, secret)}`;
}

// 验证 token 并返回 sessionId；验证失败返回 null。
export function verifySessionToken(token: string, secret: string): string | null {
  const idx = token.lastIndexOf(SEP);
  if (idx <= 0) return null;
  const sessionId = token.slice(0, idx);
  const provided = token.slice(idx + 1);
  if (!sessionId || !provided) return null;
  const expected = sign(sessionId, secret);
  if (expected.length !== provided.length) return null;
  // 常量时间比较，避免时序攻击。
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  if (diff !== 0) return null;
  return sessionId;
}

// 对 session id 做 SHA-256 摘要，用于数据库存储。
export function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('base64url');
}

// 生成新的随机 session id。
export function generateSessionId(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}
