import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateId } from '@modelharbor/shared';
import { makeAdminRig } from './helper.js';
import {
  modelGroupMembers,
  publicModels,
} from '../src/modules/db/schema.js';

const dataLearnerHtml = `
<html><body>
<h3>AA Intelligence Index</h3>
<div>1</div><div>Image: DeepSeek</div><div>DeepSeek Chat DeepSeek</div><div>86</div>
<h3>LMArena Text Generation</h3>
<div>1</div><div>Image: DeepSeek</div><div>DeepSeek Chat</div><div>DeepSeek</div><div>1420</div>
<h3>大模型性能评测结果</h3>
<div>1</div><div>Image: DeepSeek</div><div>DeepSeek Chat</div><div>DeepSeek</div>
<div>HLE 48.20</div><div>ARC-AGI-2 40.00</div><div>FrontierMath - Tier 4 12.50</div>
<div>SWE-bench Verified 80.60</div><div>τ²-Bench 81.00</div><div>免费商用</div><div>详情</div>
<div>2</div><div>Image: Moonshot AI</div><div>Kimi K2</div><div>Moonshot AI</div>
<div>HLE 54.00</div><div>ARC-AGI-2—</div><div>FrontierMath - Tier 4—</div>
<div>SWE-bench Verified 90.20</div><div>τ²-Bench—</div><div>免费商用</div>
</body></html>
`;

function mockDataLearner() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes('datalearner.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => dataLearnerHtml,
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '<html></html>',
      };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedPublicModel(rig: Awaited<ReturnType<typeof makeAdminRig>>, name: string) {
  const now = new Date();
  const id = generateId('publicModel');
  await rig.db.insert(publicModels).values({
    id,
    name,
    displayName: name,
    description: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe('model reference admin API', () => {
  it('refreshes the global DataLearner reference and respects TTL', async () => {
    const rig = await makeAdminRig();
    try {
      mockDataLearner();
      const refreshed = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/model-reference/refresh',
        headers: { cookie: rig.cookie },
        payload: { force: true },
      });
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json().refreshed).toBe(true);
      expect(refreshed.json().sources).toEqual(['datalearner']);

      const list = await rig.app.inject({
        method: 'GET',
        url: '/api/admin/model-reference',
        headers: { cookie: rig.cookie },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().items.length).toBeGreaterThan(0);
      expect(list.json().sync).toHaveLength(1);
      expect(list.json().items[0].region).toBe('global');
      expect(list.json().items[0].scores).toHaveProperty('math');
      expect(list.json().items[0].scores).toHaveProperty('chat');
      const deepseek = list.json().items.find((item: { displayName: string }) => item.displayName === 'DeepSeek Chat');
      expect(deepseek.provider).toBe('DeepSeek');
      expect(deepseek.scores.intelligence).toBe(86);
      expect(list.json().items.some((item: { displayName: string }) => item.displayName.startsWith('Image:'))).toBe(false);

      const cached = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/model-reference/refresh',
        headers: { cookie: rig.cookie },
        payload: { force: false },
      });
      expect(cached.statusCode).toBe(200);
      expect(cached.json().refreshed).toBe(false);
    } finally {
      await rig.close();
    }
  }, 20_000);

  it('creates auto groups as member snapshots and refreshes only on demand', async () => {
    const rig = await makeAdminRig();
    try {
      mockDataLearner();
      const deepseekId = await seedPublicModel(rig, 'deepseek-chat');
      await seedPublicModel(rig, 'qwen-plus');
      await rig.app.inject({
        method: 'POST',
        url: '/api/admin/model-reference/refresh',
        headers: { cookie: rig.cookie },
        payload: { force: true },
      });

      const created = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/model-groups',
        headers: { cookie: rig.cookie },
        payload: {
          name: 'auto-code',
          mode: 'auto_snapshot',
          autoPreset: 'code',
          autoWeights: { coding: 1 },
          autoTopN: 1,
        },
      });
      expect(created.statusCode).toBe(200);
      const group = created.json();
      expect(group.mode).toBe('auto_snapshot');
      expect(group.autoReferenceRegion).toBe('global');
      expect(group.members).toHaveLength(1);
      expect(group.members[0].publicModelId).toBe(deepseekId);

      const kimiId = await seedPublicModel(rig, 'kimi-k2');
      await rig.app.inject({
        method: 'POST',
        url: '/api/admin/model-reference/refresh',
        headers: { cookie: rig.cookie },
        payload: { force: true },
      });
      const beforeManualRefresh = await rig.db
        .select()
        .from(modelGroupMembers)
        .where(eq(modelGroupMembers.modelGroupId, group.id))
        .all();
      expect(beforeManualRefresh).toHaveLength(1);
      expect(beforeManualRefresh[0]!.publicModelId).toBe(deepseekId);

      const refreshed = await rig.app.inject({
        method: 'POST',
        url: `/api/admin/model-groups/${group.id}/refresh-auto`,
        headers: { cookie: rig.cookie },
      });
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json().members).toHaveLength(1);
      expect(refreshed.json().members[0].publicModelId).toBe(kimiId);
    } finally {
      await rig.close();
    }
  }, 20_000);
});
