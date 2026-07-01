import type { Db } from '../../src/infrastructure/db/client.js';
import { ProviderAccountService } from '../../src/application/provider-account.service.js';
import { EndpointRepository } from '../../src/infrastructure/db/repositories/endpoint.repository.js';
import type { ProviderAccountRow, EndpointRow } from '../../src/infrastructure/db/schema.js';

/**
 * 测试 helper：创建 Provider Account 并拿到它的一个 endpoint。
 *
 * v1 收口后，candidate 必须绑定 endpointId。ProviderAccountService.createProviderAccount
 * 在没有 providerPresetId / endpoints 入参时会通过 resolvePresetDefaults fallback
 * 自动建一个 endpoint（baseUrl = account.baseUrl），所以这里直接复用现有 endpoint，
 * 不再额外创建。
 */
export async function createTestProviderAccountWithEndpoint(
  db: Db,
  opts: {
    secretKey?: string;
    name: string;
    providerType: ProviderAccountRow['providerType'];
    baseUrl?: string;
    apiKey?: string;
    protocol?: 'openai' | 'anthropic' | 'codex';
  },
): Promise<{ account: ProviderAccountRow; endpoint: EndpointRow }> {
  const secretKey = opts.secretKey ?? 'test-secret-key';
  const accountService = new ProviderAccountService(db, secretKey);
  const account = await accountService.createProviderAccount({
    name: opts.name,
    providerType: opts.providerType,
    baseUrl: opts.baseUrl ?? 'https://test.example.com',
    apiKey: opts.apiKey ?? 'sk-test',
  });
  const endpointRepo = new EndpointRepository(db);
  const endpoints = await endpointRepo.listByProviderAccount(account.id);
  if (endpoints.length === 0) {
    throw new Error(
      `createTestProviderAccountWithEndpoint: account ${account.id} 没有 endpoint（这不应该发生）`,
    );
  }
  return { account, endpoint: endpoints[0]! };
}
