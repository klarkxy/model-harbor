import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from '../../src/domain/upstream/secret-crypto.js';

describe('secret crypto', () => {
  it('roundtrips upstream secret', () => {
    const secretKey = 'my-32-byte-or-longer-secret-key-for-tests';
    const plaintext = 'sk-proj-test-key-12345';
    const { ciphertext, prefix } = encryptSecret(plaintext, secretKey);
    expect(ciphertext).not.toBe(plaintext);
    expect(prefix).toBe('sk-p');

    const decrypted = decryptSecret(ciphertext, secretKey);
    expect(decrypted).toBe(plaintext);
  });

  it('fails decryption with wrong secret', () => {
    const secretKey = 'correct-secret-key-for-unit-tests';
    const plaintext = 'super-secret-api-key';
    const { ciphertext } = encryptSecret(plaintext, secretKey);
    expect(() => decryptSecret(ciphertext, 'wrong-secret-key-for-unit-tests')).toThrow();
  });
});
