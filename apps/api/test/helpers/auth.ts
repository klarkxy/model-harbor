import type { FastifyInstance } from 'fastify';

export const TEST_ADMIN = {
  username: 'admin',
  password: 'change-me-on-first-run',
} as const;

/**
 * 通过 setup/security 确保测试管理员已创建，然后登录并返回 session cookie。
 * 空库时 setup/security 会创建首个管理员；已有管理员时校验密码。
 */
export async function loginAsAdmin(app: FastifyInstance): Promise<string> {
  const setup = await app.inject({
    method: 'POST',
    url: '/api/admin/setup/security',
    payload: TEST_ADMIN,
  });
  if (setup.statusCode !== 200) {
    throw new Error(`setup/security failed: ${setup.payload}`);
  }
  const setupBody = JSON.parse(setup.payload) as { data?: { ok?: boolean } };
  if (!setupBody.data?.ok) {
    throw new Error(`setup/security rejected credentials: ${setup.payload}`);
  }

  const login = await app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: TEST_ADMIN,
  });
  if (login.statusCode !== 200) {
    throw new Error(`admin login failed: ${login.payload}`);
  }
  const cookie = login.cookies.find((c) => c.name === 'session');
  if (!cookie) {
    throw new Error('admin login response did not contain session cookie');
  }
  return cookie.value;
}
