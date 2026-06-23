import { describe, expect, it } from 'vitest';
import { makeAdminRig } from './helper.js';

describe('apps admin API', () => {
  it('creates, lists, gets, and updates apps; rejects duplicates with 409', async () => {
    const rig = await makeAdminRig();
    try {
      // Empty list initially.
      const empty = await rig.app.inject({
        method: 'GET',
        url: '/api/admin/apps',
        headers: { cookie: rig.cookie },
      });
      expect(empty.statusCode).toBe(200);
      expect(empty.json().items).toEqual([]);

      // Create an app.
      const created = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/apps',
        headers: { cookie: rig.cookie },
        payload: { name: 'prod-app', description: 'Production' },
      });
      expect(created.statusCode).toBe(200);
      const app = created.json();
      expect(app).toMatchObject({ name: 'prod-app', description: 'Production', enabled: true });
      expect(app.id).toBeTruthy();

      // Duplicate name should be rejected.
      const dup = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/apps',
        headers: { cookie: rig.cookie },
        payload: { name: 'prod-app' },
      });
      expect(dup.statusCode).toBe(409);

      // Empty name should be rejected with a validation error.
      const emptyName = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/apps',
        headers: { cookie: rig.cookie },
        payload: { name: '' },
      });
      expect(emptyName.statusCode).toBe(400);

      // GET by id.
      const got = await rig.app.inject({
        method: 'GET',
        url: `/api/admin/apps/${app.id}`,
        headers: { cookie: rig.cookie },
      });
      expect(got.statusCode).toBe(200);
      expect(got.json().id).toBe(app.id);

      // GET with unknown id returns 404.
      const missing = await rig.app.inject({
        method: 'GET',
        url: '/api/admin/apps/app_does_not_exist',
        headers: { cookie: rig.cookie },
      });
      expect(missing.statusCode).toBe(404);

      // PATCH updates description and enabled.
      const patched = await rig.app.inject({
        method: 'PATCH',
        url: `/api/admin/apps/${app.id}`,
        headers: { cookie: rig.cookie },
        payload: { description: 'Staging mirror', enabled: false },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json()).toMatchObject({
        description: 'Staging mirror',
        enabled: false,
      });

      // PATCH with unknown id returns 404.
      const patchMissing = await rig.app.inject({
        method: 'PATCH',
        url: '/api/admin/apps/app_does_not_exist',
        headers: { cookie: rig.cookie },
        payload: { enabled: true },
      });
      expect(patchMissing.statusCode).toBe(404);

      // After creating a second app, listing should return both, newest first.
      const created2 = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/apps',
        headers: { cookie: rig.cookie },
        payload: { name: 'staging-app' },
      });
      expect(created2.statusCode).toBe(200);

      const list = await rig.app.inject({
        method: 'GET',
        url: '/api/admin/apps',
        headers: { cookie: rig.cookie },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().items).toHaveLength(2);
      // desc(createdAt) puts the newer one first.
      expect(list.json().items[0].name).toBe('staging-app');
      expect(list.json().items[1].name).toBe('prod-app');
    } finally {
      await rig.close();
    }
  }, 20_000);

  it('rejects app updates that try to rename into another existing app', async () => {
    const rig = await makeAdminRig();
    try {
      const a = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/apps',
        headers: { cookie: rig.cookie },
        payload: { name: 'app-a' },
      });
      const b = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/apps',
        headers: { cookie: rig.cookie },
        payload: { name: 'app-b' },
      });
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);

      // Renaming b -> a should 409.
      const conflict = await rig.app.inject({
        method: 'PATCH',
        url: `/api/admin/apps/${b.json().id}`,
        headers: { cookie: rig.cookie },
        payload: { name: 'app-a' },
      });
      expect(conflict.statusCode).toBe(409);
    } finally {
      await rig.close();
    }
  }, 20_000);
});