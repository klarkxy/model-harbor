import type { ProviderAccountRow } from '../../../infrastructure/db/schema.js';

export interface ProviderAccountWithoutSecrets extends Omit<
  ProviderAccountRow,
  'apiKeyCiphertext' | 'authConfigCiphertext'
> {
  authConfigPrefix?: string;
}

/**
 * Phase 2 Slice 1：去掉 Provider Account row 上的密钥密文。
 *
 * Provider Account 边界包含 `apiKeyCiphertext` / `authConfigCiphertext`，
 * 但 HTTP 响应不应泄露这些字段。所有 admin route 在序列化前必须调用本函数。
 */
export function stripProviderAccountSecrets<T extends ProviderAccountRow>(
  row: T,
): Omit<T, 'apiKeyCiphertext' | 'authConfigCiphertext'> {
  const {
    apiKeyCiphertext: _apiKeyCiphertext,
    authConfigCiphertext: _authConfigCiphertext,
    ...rest
  } = row;
  return rest;
}
