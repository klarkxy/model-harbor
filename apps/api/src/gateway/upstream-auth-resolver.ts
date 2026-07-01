import { decryptSecret } from '../domain/upstream/secret-crypto.js';
import type { ProviderAccountRow } from '../infrastructure/db/schema.js';

export interface UpstreamAuthResolverDeps {
  secretKey: string;
}

export class UpstreamAuthResolver {
  constructor(private readonly deps: UpstreamAuthResolverDeps) {}

  async resolveAuthHeaders(account: ProviderAccountRow): Promise<Record<string, string>> {
    if (account.authType === 'oauth') {
      throw new Error('OAuth upstream auth is not implemented yet');
    }

    const apiKey = decryptSecret(account.apiKeyCiphertext, this.deps.secretKey);
    return {
      Authorization: `Bearer ${apiKey}`,
    };
  }
}
