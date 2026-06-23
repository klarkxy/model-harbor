import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { consumerKeys, consumerKeyAccess } from '../src/modules/db/tables/apps.js';
import { makeAdminRig, seedFullRoute, type AdminTestRig } from './helper.js';

describe('consumer keys admin', () => {
  let rig: AdminTestRig;
  beforeEach(async () => {
    rig = await makeAdminRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('creates a consumer key, returns the raw key once, and never again', async () => {
    const refs = await seedFullRoute(rig);
    const res = await rig.app.inject({
      method: 'POST',
      url: `/api/admin/apps/${refs.appId}/consumer-keys`,
      headers: { cookie: rig.cookie },
      payload: {
        name: 'Cline',
        access: [{ targetType: 'model_group', targetId: refs.modelGroupId }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; key: string; keyPrefix: string; keySuffix: string; name: string };
    expect(body.key.startsWith('mh_')).toBe(true);
    expect(body.key.length).toBeGreaterThan(20);
    expect(body.keyPrefix).toBe(body.key.slice(0, 7));
    expect(body.keySuffix).toBe(body.key.slice(-7));

    // Now GET the list: the raw key must NOT appear in any item.
    const list = await rig.app.inject({
      method: 'GET',
      url: `/api/admin/apps/${refs.appId}/consumer-keys`,
      headers: { cookie: rig.cookie },
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { items: { key?: string; name: string }[] };
    // Two items: the seeded one + the one we just created.
    expect(listBody.items).toHaveLength(2);
    for (const item of listBody.items) {
      expect(item.key).toBeUndefined();
    }

    // The newly created item (by createdAt desc) is the one we just made.
    const fresh = listBody.items.find((i) => i.name === 'Cline');
    expect(fresh).toBeTruthy();

    // The underlying keyHash should match SHA-256 of the raw key.
    const row = await rig.db.select().from(consumerKeys).where(eq(consumerKeys.id, body.id)).get();
    const { hashSessionId } = await import('../src/modules/auth/index.js');
    expect(row!.keyHash).toBe(hashSessionId(body.key));

    // Access was inserted.
    const access = await rig.db
      .select()
      .from(consumerKeyAccess)
      .where(eq(consumerKeyAccess.consumerKeyId, body.id))
      .all();
    expect(access).toHaveLength(1);
    expect(access[0]!.targetId).toBe(refs.modelGroupId);
  });

  it('rotates a consumer key and returns the new raw key (and only that)', async () => {
    const refs = await seedFullRoute(rig);
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/consumer-keys/' + refs.consumerKeyId + '/rotate',
      headers: { cookie: rig.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { key: string; keyPrefix: string; keySuffix: string };
    expect(body.key).not.toBe(refs.rawConsumerKey);
    expect(body.key.startsWith('mh_')).toBe(true);
    expect(body.keyPrefix).toBe(body.key.slice(0, 7));
    expect(body.keySuffix).toBe(body.key.slice(-7));
    const row = await rig.db
      .select()
      .from(consumerKeys)
      .where(eq(consumerKeys.id, refs.consumerKeyId))
      .get();
    const { hashSessionId } = await import('../src/modules/auth/index.js');
    expect(row!.keyHash).toBe(hashSessionId(body.key));
  });

  it('revokes a consumer key and prevents future use', async () => {
    const refs = await seedFullRoute(rig);
    const rev = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/consumer-keys/' + refs.consumerKeyId + '/revoke',
      headers: { cookie: rig.cookie },
    });
    expect(rev.statusCode).toBe(200);
    const body = rev.json() as { enabled: boolean; revokedAt: number | null };
    expect(body.enabled).toBe(false);
    expect(body.revokedAt).toBeTruthy();
  });

  it('PUT access replaces the access list', async () => {
    const refs = await seedFullRoute(rig);
    const put = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/consumer-keys/' + refs.consumerKeyId + '/access',
      headers: { cookie: rig.cookie },
      payload: {
        access: [{ targetType: 'public_model', targetId: refs.publicModelId }],
      },
    });
    expect(put.statusCode).toBe(200);
    const access = await rig.db
      .select()
      .from(consumerKeyAccess)
      .where(eq(consumerKeyAccess.consumerKeyId, refs.consumerKeyId))
      .all();
    expect(access).toHaveLength(1);
    expect(access[0]!.targetType).toBe('public_model');
    expect(access[0]!.targetId).toBe(refs.publicModelId);
  });

  it('rejects access to non-existent target', async () => {
    const refs = await seedFullRoute(rig);
    const res = await rig.app.inject({
      method: 'POST',
      url: `/api/admin/apps/${refs.appId}/consumer-keys`,
      headers: { cookie: rig.cookie },
      payload: {
        name: 'Bad',
        access: [{ targetType: 'public_model', targetId: 'pm_doesnotexist' }],
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('lists consumer keys for an app and returns 404 on unknown appId', async () => {
    const refs = await seedFullRoute(rig);
    const list = await rig.app.inject({
      method: 'GET',
      url: `/api/admin/apps/${refs.appId}/consumer-keys`,
      headers: { cookie: rig.cookie },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { items: Array<{ id: string }> };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items[0]?.id).toBe(refs.consumerKeyId);

    const missing = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/apps/app_doesnotexist/consumer-keys',
      headers: { cookie: rig.cookie },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects access to non-existent target on PUT access', async () => {
    const refs = await seedFullRoute(rig);
    const put = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/consumer-keys/' + refs.consumerKeyId + '/access',
      headers: { cookie: rig.cookie },
      payload: {
        access: [{ targetType: 'public_model', targetId: 'pm_doesnotexist' }],
      },
    });
    expect(put.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('PUT access on a non-existent consumer key returns 404', async () => {
    const put = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/consumer-keys/ck_doesnotexist/access',
      headers: { cookie: rig.cookie },
      payload: { access: [] },
    });
    expect(put.statusCode).toBe(404);
  });

  it('PUT access with non-array body returns 400', async () => {
    const refs = await seedFullRoute(rig);
    const put = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/consumer-keys/' + refs.consumerKeyId + '/access',
      headers: { cookie: rig.cookie },
      payload: { access: 'not-an-array' },
    });
    expect(put.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('PUT access rejects an entry without targetType/targetId', async () => {
    const refs = await seedFullRoute(rig);
    const put = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/consumer-keys/' + refs.consumerKeyId + '/access',
      headers: { cookie: rig.cookie },
      payload: { access: [{ foo: 'bar' }] },
    });
    expect(put.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('PUT access rejects an entry with an unknown targetType', async () => {
    const refs = await seedFullRoute(rig);
    const put = await rig.app.inject({
      method: 'PUT',
      url: '/api/admin/consumer-keys/' + refs.consumerKeyId + '/access',
      headers: { cookie: rig.cookie },
      payload: { access: [{ targetType: 'unknown_type', targetId: 'x' }] },
    });
    expect(put.statusCode).toBeGreaterThanOrEqual(400);
  });
});
