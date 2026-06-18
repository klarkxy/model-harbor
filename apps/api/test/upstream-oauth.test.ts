import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { oauthSessions, upstreamKeys } from '../src/modules/db/index.js';
import { decryptSecret } from '../src/modules/auth/crypto.js';
import { parseJsonRecord } from '../src/modules/admin/helpers.js';
import { makeAdminRig, type AdminTestRig } from './helper.js';

describe('upstream key browser OAuth', () => {
  let rig: AdminTestRig;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    rig = await makeAdminRig();
    originalFetch = global.fetch;
  });
  afterEach(async () => {
    global.fetch = originalFetch;
    await rig.close();
  });

  it('starts a Codex OAuth session and returns an authorization URL', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys/oauth-init',
      headers: { cookie: rig.cookie },
      payload: {
        provider: 'codex',
        authType: 'codex_oauth',
        redirectUri: 'https://example.com/oauth/callback',
        draft: {
          name: 'codex-oauth-key',
          providerType: 'codex',
          baseUrl: 'https://api.openai.com',
          modelMappings: [{ realName: 'gpt-5.5', publicName: 'gpt-codex', enabled: true }],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { authorizationUrl: string; state: string };
    expect(body.authorizationUrl).toContain('https://auth.openai.com/oauth/authorize');
    expect(body.authorizationUrl).toContain(
      `client_id=${encodeURIComponent('app_EMoamEEZ73f0CkXaXp7hrann')}`,
    );
    expect(body.authorizationUrl).toContain('code_challenge=');
    expect(body.state).toBeTruthy();

    const session = await rig.db
      .select()
      .from(oauthSessions)
      .where(eq(oauthSessions.id, body.state))
      .get();
    expect(session).toBeTruthy();
    expect(session!.provider).toBe('codex');
    expect(session!.codeVerifier).toBeTruthy();
  });

  it('starts a Coze OAuth session and returns an authorization URL', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys/oauth-init',
      headers: { cookie: rig.cookie },
      payload: {
        provider: 'coze',
        authType: 'coze_oauth_pkce',
        clientId: 'coze-client-123',
        redirectUri: 'https://example.com/oauth/callback',
        baseUrl: 'https://api.coze.cn',
        workspaceId: 'workspace-123',
        draft: {
          name: 'coze-oauth-key',
          providerPresetId: 'coze',
          modelMappings: [{ realName: 'bot-1', publicName: 'coze-bot', enabled: true }],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { authorizationUrl: string; state: string };
    expect(body.authorizationUrl).toContain(
      'https://www.coze.cn/api/permission/oauth2/workspace_id/workspace-123/authorize',
    );
    expect(body.authorizationUrl).toContain('client_id=coze-client-123');
    expect(body.state).toBeTruthy();
  });

  it('exchanges a Codex code and creates the upstream key', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: 'codex-access',
          refresh_token: 'codex-refresh',
          expires_in: 3600,
        }),
    }) as unknown as typeof global.fetch;

    const init = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys/oauth-init',
      headers: { cookie: rig.cookie },
      payload: {
        provider: 'codex',
        authType: 'codex_oauth',
        redirectUri: 'https://example.com/oauth/callback',
        draft: {
          name: 'codex-exchange-key',
          providerType: 'codex',
          baseUrl: 'https://api.openai.com',
          modelMappings: [{ realName: 'gpt-5.5', publicName: 'gpt-codex', enabled: true }],
        },
      },
    });
    const { state } = init.json() as { state: string };

    const exchange = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys/oauth-exchange',
      headers: { cookie: rig.cookie },
      payload: { state, code: 'auth-code-123' },
    });

    expect(exchange.statusCode).toBe(200);
    const key = exchange.json() as { id: string; name: string; authType: string };
    expect(key.name).toBe('codex-exchange-key');
    expect(key.authType).toBe('codex_oauth');

    const row = await rig.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, key.id)).get();
    expect(row).toBeTruthy();
    const config = parseJsonRecord(decryptSecret(row!.authConfigCiphertext!, rig.secretKey)) as {
      refreshToken: string;
    };
    expect(config.refreshToken).toBe('codex-refresh');

    const session = await rig.db
      .select()
      .from(oauthSessions)
      .where(eq(oauthSessions.id, state))
      .get();
    expect(session).toBeUndefined();
  });

  it('exchanges a Coze code and creates the upstream key', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: 'coze-access',
          refresh_token: 'coze-refresh',
          expires_in: 3600,
        }),
    }) as unknown as typeof global.fetch;

    const init = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys/oauth-init',
      headers: { cookie: rig.cookie },
      payload: {
        provider: 'coze',
        authType: 'coze_oauth_pkce',
        clientId: 'coze-client-123',
        redirectUri: 'https://example.com/oauth/callback',
        baseUrl: 'https://api.coze.cn',
        draft: {
          name: 'coze-exchange-key',
          providerPresetId: 'coze',
          modelMappings: [{ realName: 'bot-1', publicName: 'coze-bot', enabled: true }],
        },
      },
    });
    const { state } = init.json() as { state: string };

    const exchange = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys/oauth-exchange',
      headers: { cookie: rig.cookie },
      payload: { state, code: 'auth-code-123' },
    });

    expect(exchange.statusCode).toBe(200);
    const key = exchange.json() as { id: string; name: string; authType: string };
    expect(key.name).toBe('coze-exchange-key');
    expect(key.authType).toBe('coze_oauth_pkce');

    const row = await rig.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, key.id)).get();
    expect(row).toBeTruthy();
    const config = parseJsonRecord(decryptSecret(row!.authConfigCiphertext!, rig.secretKey)) as {
      refreshToken: string;
      clientId: string;
    };
    expect(config.refreshToken).toBe('coze-refresh');
    expect(config.clientId).toBe('coze-client-123');
  });

  it('rejects an exchange with an invalid or expired state', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys/oauth-exchange',
      headers: { cookie: rig.cookie },
      payload: { state: 'no-such-state', code: 'auth-code-123' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('oauth_session_invalid');
  });
});
