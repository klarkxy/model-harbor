import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { cozeOauthJwtStrategy } from '../src/modules/providers/auth/coze-oauth-jwt.js';
import {
  codexOauthStrategy,
  _resetCodexOauthCache,
} from '../src/modules/providers/auth/codex-oauth.js';
import {
  cozeOauthPkceStrategy,
  _resetCozeOauthPkceCache,
} from '../src/modules/providers/auth/coze-oauth-pkce.js';
import { encryptSecret } from '../src/modules/auth/crypto.js';

describe('coze oauth jwt strategy', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const secretKey = 'test-secret-key-32-characters!!';
  const baseUrl = 'https://api.coze.cn';

  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function makeCtx(config: Record<string, unknown>, id = randomUUID()) {
    const ciphertext = encryptSecret(JSON.stringify(config), secretKey).ciphertext;
    return {
      row: {
        id,
        authType: 'coze_oauth_jwt' as const,
        apiKeyCiphertext: '',
        authConfigCiphertext: ciphertext,
      },
      secretKey,
      baseUrl,
    };
  }

  it('validates a correct config', () => {
    const validated = cozeOauthJwtStrategy.validateConfig({
      appId: '123',
      kid: 'kid-1',
      privateKey: privatePem,
      durationSeconds: 3600,
    });
    expect(validated.appId).toBe('123');
    expect(validated.kid).toBe('kid-1');
    expect(validated.durationSeconds).toBe(3600);
  });

  it('rejects config with missing fields', () => {
    expect(() => cozeOauthJwtStrategy.validateConfig({ appId: '123' })).toThrow('kid is required');
    expect(() => cozeOauthJwtStrategy.validateConfig({ appId: '123', kid: 'kid-1' })).toThrow(
      'privateKey is required',
    );
  });

  it('exchanges a signed JWT for an access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ access_token: 'coze-access-token', expires_in: 1893456000 }),
    }) as unknown as typeof global.fetch;
    global.fetch = fetchMock;

    const header = await cozeOauthJwtStrategy.getHeader(
      makeCtx({ appId: '123', kid: 'kid-1', privateKey: privatePem }),
    );

    expect(header.header).toBe('Bearer coze-access-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(call[0]).toBe('https://api.coze.cn/api/permission/oauth2/token');
    const body = JSON.parse(call[1].body);
    expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
  });

  it('reuses a cached token until near expiry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ access_token: 'cached-token', expires_in: Date.now() / 1000 + 3600 }),
    }) as unknown as typeof global.fetch;
    global.fetch = fetchMock;

    const cacheId = randomUUID();
    const ctx = makeCtx({ appId: '123', kid: 'kid-1', privateKey: privatePem }, cacheId);
    const first = await cozeOauthJwtStrategy.getHeader(ctx);
    const second = await cozeOauthJwtStrategy.getHeader(
      makeCtx({ appId: '123', kid: 'kid-1', privateKey: privatePem }, cacheId),
    );

    expect(first.header).toBe('Bearer cached-token');
    expect(second.header).toBe('Bearer cached-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the token exchange fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }) as unknown as typeof global.fetch;

    await expect(
      cozeOauthJwtStrategy.getHeader(
        makeCtx({ appId: '123', kid: 'kid-1', privateKey: privatePem }),
      ),
    ).rejects.toThrow('401');
  });
});

describe('codex oauth strategy', () => {
  const secretKey = 'test-secret-key-32-characters!!';
  const baseUrl = 'https://api.openai.com';

  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    _resetCodexOauthCache();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function makeCtx(
    config: Record<string, unknown>,
    id = randomUUID(),
    db?: {
      update: () => {
        set: (values: Record<string, unknown>) => {
          where: () => Promise<void>;
        };
      };
    },
  ) {
    const ciphertext = encryptSecret(JSON.stringify(config), secretKey).ciphertext;
    return {
      row: {
        id,
        authType: 'codex_oauth' as const,
        apiKeyCiphertext: '',
        authConfigCiphertext: ciphertext,
      },
      secretKey,
      baseUrl,
      db,
    };
  }

  it('validates a correct config and applies defaults', () => {
    const validated = codexOauthStrategy.validateConfig({ refreshToken: 'rt-123' });
    expect(validated.refreshToken).toBe('rt-123');
    expect(validated.clientId).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
    expect(validated.tokenUrl).toBe('https://auth.openai.com/oauth/token');
  });

  it('rejects config with missing refreshToken', () => {
    expect(() => codexOauthStrategy.validateConfig({})).toThrow('refreshToken is required');
  });

  it('exchanges a refresh token for an access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'codex-access-token', expires_in: 3600 }),
    }) as unknown as typeof global.fetch;
    global.fetch = fetchMock;

    const header = await codexOauthStrategy.getHeader(makeCtx({ refreshToken: 'rt-123' }));

    expect(header.header).toBe('Bearer codex-access-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(call[0]).toBe('https://auth.openai.com/oauth/token');
    const body = new URLSearchParams(call[1].body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-123');
    expect(body.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
  });

  it('reuses a cached token until near expiry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'cached-token', expires_in: 3600 }),
    }) as unknown as typeof global.fetch;
    global.fetch = fetchMock;

    const cacheId = randomUUID();
    const ctx = makeCtx({ refreshToken: 'rt-123' }, cacheId);
    const first = await codexOauthStrategy.getHeader(ctx);
    const second = await codexOauthStrategy.getHeader(makeCtx({ refreshToken: 'rt-123' }, cacheId));

    expect(first.header).toBe('Bearer cached-token');
    expect(second.header).toBe('Bearer cached-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('persists a rotated refresh token back to the database', async () => {
    const updated = { values: null as Record<string, unknown> | null, id: null as string | null };
    const fakeDb = {
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            updated.values = values;
            return Promise.resolve();
          },
        }),
      }),
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: 'new-access-token',
          refresh_token: 'rt-rotated',
          expires_in: 3600,
        }),
    }) as unknown as typeof global.fetch;

    const keyId = randomUUID();
    await codexOauthStrategy.getHeader(makeCtx({ refreshToken: 'rt-123' }, keyId, fakeDb as never));

    expect(updated.values).not.toBeNull();
    expect(updated.values!.authConfigCiphertext).toBeDefined();
    expect(updated.values!.updatedAt).toBeInstanceOf(Date);
  });

  it('throws when the token refresh fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'invalid_grant' }),
    }) as unknown as typeof global.fetch;

    await expect(codexOauthStrategy.getHeader(makeCtx({ refreshToken: 'rt-123' }))).rejects.toThrow(
      'invalid_grant',
    );
  });
});

describe('coze oauth pkce strategy', () => {
  const secretKey = 'test-secret-key-32-characters!!';
  const baseUrl = 'https://api.coze.cn';

  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    _resetCozeOauthPkceCache();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function makeCtx(
    config: Record<string, unknown>,
    id = randomUUID(),
    db?: {
      update: () => {
        set: (values: Record<string, unknown>) => {
          where: () => Promise<void>;
        };
      };
    },
  ) {
    const ciphertext = encryptSecret(JSON.stringify(config), secretKey).ciphertext;
    return {
      row: {
        id,
        authType: 'coze_oauth_pkce' as const,
        apiKeyCiphertext: '',
        authConfigCiphertext: ciphertext,
      },
      secretKey,
      baseUrl,
      db,
    };
  }

  it('validates a correct config', () => {
    const validated = cozeOauthPkceStrategy.validateConfig({
      refreshToken: 'rt-123',
      clientId: 'client-123',
      redirectUri: 'https://example.com/oauth/callback',
    });
    expect(validated.refreshToken).toBe('rt-123');
    expect(validated.clientId).toBe('client-123');
    expect(validated.redirectUri).toBe('https://example.com/oauth/callback');
  });

  it('rejects config with missing fields', () => {
    expect(() => cozeOauthPkceStrategy.validateConfig({ refreshToken: 'rt-123' })).toThrow(
      'clientId is required',
    );
    expect(() =>
      cozeOauthPkceStrategy.validateConfig({ refreshToken: 'rt-123', clientId: 'client-123' }),
    ).toThrow('redirectUri is required');
  });

  it('exchanges a refresh token for an access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'coze-access-token', expires_in: 3600 }),
    }) as unknown as typeof global.fetch;
    global.fetch = fetchMock;

    const header = await cozeOauthPkceStrategy.getHeader(
      makeCtx({
        refreshToken: 'rt-123',
        clientId: 'client-123',
        redirectUri: 'https://example.com/oauth/callback',
      }),
    );

    expect(header.header).toBe('Bearer coze-access-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(call[0]).toBe('https://api.coze.cn/api/permission/oauth2/token');
    const body = JSON.parse(call[1].body);
    expect(body.grant_type).toBe('refresh_token');
    expect(body.client_id).toBe('client-123');
    expect(body.refresh_token).toBe('rt-123');
  });

  it('reuses a cached token until near expiry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'cached-token', expires_in: 3600 }),
    }) as unknown as typeof global.fetch;
    global.fetch = fetchMock;

    const cacheId = randomUUID();
    const ctx = makeCtx(
      {
        refreshToken: 'rt-123',
        clientId: 'client-123',
        redirectUri: 'https://example.com/oauth/callback',
      },
      cacheId,
    );
    const first = await cozeOauthPkceStrategy.getHeader(ctx);
    const second = await cozeOauthPkceStrategy.getHeader(
      makeCtx(
        {
          refreshToken: 'rt-123',
          clientId: 'client-123',
          redirectUri: 'https://example.com/oauth/callback',
        },
        cacheId,
      ),
    );

    expect(first.header).toBe('Bearer cached-token');
    expect(second.header).toBe('Bearer cached-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('persists a rotated refresh token back to the database', async () => {
    const updated = { values: null as Record<string, unknown> | null, id: null as string | null };
    const fakeDb = {
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            updated.values = values;
            return Promise.resolve();
          },
        }),
      }),
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: 'new-access-token',
          refresh_token: 'rt-rotated',
          expires_in: 3600,
        }),
    }) as unknown as typeof global.fetch;

    const keyId = randomUUID();
    await cozeOauthPkceStrategy.getHeader(
      makeCtx(
        {
          refreshToken: 'rt-123',
          clientId: 'client-123',
          redirectUri: 'https://example.com/oauth/callback',
        },
        keyId,
        fakeDb as never,
      ),
    );

    expect(updated.values).not.toBeNull();
    expect(updated.values!.authConfigCiphertext).toBeDefined();
    expect(updated.values!.updatedAt).toBeInstanceOf(Date);
  });

  it('throws when the token refresh fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }) as unknown as typeof global.fetch;

    await expect(
      cozeOauthPkceStrategy.getHeader(
        makeCtx({
          refreshToken: 'rt-123',
          clientId: 'client-123',
          redirectUri: 'https://example.com/oauth/callback',
        }),
      ),
    ).rejects.toThrow('Unauthorized');
  });
});
