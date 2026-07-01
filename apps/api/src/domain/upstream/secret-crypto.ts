import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const SALT = Buffer.from('manageyourllm:encryption:v1', 'utf8');

function deriveKey(secretKey: string): Buffer {
  return scryptSync(secretKey, SALT, KEY_LEN, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

export interface EncryptResult {
  ciphertext: string;
  prefix: string;
}

// 使用 AES-256-GCM 加密上游 secret，返回 base64 密文与明文前缀。
export function encryptSecret(plaintext: string, secretKey: string): EncryptResult {
  const key = deriveKey(secretKey);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, enc]).toString('base64');
  return { ciphertext: payload, prefix: plaintext.slice(0, 4) };
}

// 解密上游 secret。密钥错误时抛出异常。
export function decryptSecret(ciphertext: string, secretKey: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('密文太短');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const key = deriveKey(secretKey);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}
