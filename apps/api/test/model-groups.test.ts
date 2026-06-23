import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { modelGroups } from '../src/modules/db/tables/models.js';
import { targetNames } from '../src/modules/db/tables/routing.js';
import { makeAdminRig, seedFullRoute, type AdminTestRig } from './helper.js';

describe('model groups admin', () => {
  let rig: AdminTestRig;
  beforeEach(async () => {
    rig = await makeAdminRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('rolls back the whole create when a member points at a missing public model', async () => {
    await seedFullRoute(rig);
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/model-groups',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'mg-rollback',
        members: [{ publicModelId: 'publicModel_does-not-exist', priority: 10 }],
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    // The group row and its target_names row should be gone.
    const mg = await rig.db
      .select()
      .from(modelGroups)
      .where(eq(modelGroups.name, 'mg-rollback'))
      .get();
    expect(mg).toBeUndefined();
    const tn = await rig.db
      .select()
      .from(targetNames)
      .where(eq(targetNames.name, 'mg-rollback'))
      .get();
    expect(tn).toBeUndefined();
    // Name must be reusable after the failure.
    const retry = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/model-groups',
      headers: { cookie: rig.cookie },
      payload: { name: 'mg-rollback' },
    });
    expect(retry.statusCode).toBe(200);
  });

  it('creates a group with a valid routing policy and rejects invalid ones', async () => {
    await seedFullRoute(rig);
    const createRes = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/model-groups',
      headers: { cookie: rig.cookie },
      payload: { name: 'mg-policy', routingPolicy: 'round_robin' },
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json() as { routingPolicy: string };
    expect(created.routingPolicy).toBe('round_robin');

    const invalidRes = await rig.app.inject({
      method: 'PATCH',
      url: `/api/admin/model-groups/${(created as { id: string }).id}`,
      headers: { cookie: rig.cookie },
      payload: { routingPolicy: 'bad-mode' },
    });
    expect(invalidRes.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('lists, gets, refreshes, and deletes model groups', async () => {
    const refs = await seedFullRoute(rig);
    const created = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/model-groups',
      headers: { cookie: rig.cookie },
      payload: {
        name: 'mg-life-cycle',
        members: [{ publicModelId: refs.publicModelId, priority: 10 }],
      },
    });
    expect(created.statusCode).toBe(200);
    const id = (created.json() as { id: string }).id;

    const list = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/model-groups',
      headers: { cookie: rig.cookie },
    });
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { items: Array<{ id: string }> }).items;
    expect(items.some((it) => it.id === id)).toBe(true);

    const got = await rig.app.inject({
      method: 'GET',
      url: `/api/admin/model-groups/${id}`,
      headers: { cookie: rig.cookie },
    });
    expect(got.statusCode).toBe(200);
    expect((got.json() as { id: string }).id).toBe(id);

    const missing = await rig.app.inject({
      method: 'GET',
      url: '/api/admin/model-groups/mg_doesnotexist',
      headers: { cookie: rig.cookie },
    });
    expect(missing.statusCode).toBe(404);

    const refresh = await rig.app.inject({
      method: 'POST',
      url: `/api/admin/model-groups/${id}/refresh-auto`,
      headers: { cookie: rig.cookie },
    });
    // The group was created in manual mode, so refresh-auto must reject.
    expect(refresh.statusCode).toBeGreaterThanOrEqual(400);

    const del = await rig.app.inject({
      method: 'DELETE',
      url: `/api/admin/model-groups/${id}`,
      headers: { cookie: rig.cookie },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ id, deleted: true });

    const tn = await rig.db
      .select()
      .from(targetNames)
      .where(eq(targetNames.targetId, id))
      .all();
    expect(tn).toHaveLength(0);
  });

  it('rejects refresh-auto on unknown id', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/model-groups/mg_doesnot_exist/refresh-auto',
      headers: { cookie: rig.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('patches description / enabled / routingPolicy / displayName on an existing group', async () => {
    const refs = await seedFullRoute(rig);
    void refs;
    const created = await rig.app.inject({
      method: 'POST',
      url: '/api/admin/model-groups',
      headers: { cookie: rig.cookie },
      payload: { name: 'mg-patch' },
    });
    expect(created.statusCode).toBe(200);
    const id = (created.json() as { id: string }).id;

    const patched = await rig.app.inject({
      method: 'PATCH',
      url: `/api/admin/model-groups/${id}`,
      headers: { cookie: rig.cookie },
      payload: {
        description: 'manual coder route',
        displayName: 'Manual Coder',
        enabled: false,
        routingPolicy: 'random',
      },
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json() as {
      description: string | null;
      displayName: string | null;
      enabled: boolean;
      routingPolicy: string;
    };
    expect(body.description).toBe('manual coder route');
    expect(body.displayName).toBe('Manual Coder');
    expect(body.enabled).toBe(false);
    expect(body.routingPolicy).toBe('random');
  });
});
