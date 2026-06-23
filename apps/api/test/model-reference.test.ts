import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateId } from '@modelharbor/shared';
import { makeAdminRig } from './helper.js';
import {
  modelGroupMembers,
  publicModels,
} from '../src/modules/db/schema.js';

// ReLE publishes its leaderboard as a Markdown table. The implementation
// expects the exact column order from `RELE_COLUMNS` (with `__empty__`
// being a placeholder 6th column skipped during parsing). We feed three rows
// so that auto-group ranking can pick a deterministic winner. The `coding`
// column is the dominant weight in the `code` preset (0.55), so we tune
// kimi-k2 to win after it is added so the "refresh-auto swaps the winner"
// assertion holds.
const releMarkdown = `| 排名 | 大模型 | 机构 | 输出价格 | 总分 |  | 教育 | 医疗与心理健康 | 金融 | 法律与行政公务 | 推理与数学计算 | 语言与指令遵从 | agent与工具调用 | coding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | deepseek-chat | DeepSeek | 2.0元 | 80.5 |  | 78 | 75 | 80 | 82 | 85 | 81 | 79 | 85 |
| 2 | qwen-plus | Alibaba | 4.0元 | 75.0 |  | 73 | 70 | 76 | 74 | 80 | 75 | 72 | 80 |
| 3 | kimi-k2 | Moonshot AI | 12.0元 | 70.0 |  | 68 | 65 | 70 | 69 | 75 | 70 | 67 | 95 |
`;

function mockRele() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes('raw.githubusercontent.com') && href.includes('alldata.md')) {
        return {
          ok: true,
          status: 200,
          text: async () => releMarkdown,
          json: async () => ({}),
        };
      }
      // GitHub releases API used for tagging — return empty so the
      // implementation falls back to `main`.
      if (href.includes('api.github.com/repos')) {
        return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
      }
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
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
  it('refreshes the global ReLE reference and respects TTL', async () => {
    const rig = await makeAdminRig();
    try {
      mockRele();
      const refreshed = await rig.app.inject({
        method: 'POST',
        url: '/api/admin/model-reference/refresh',
        headers: { cookie: rig.cookie },
        payload: { force: true },
      });
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json().refreshed).toBe(true);
      expect(refreshed.json().sources).toEqual(['rele']);

      const list = await rig.app.inject({
        method: 'GET',
        url: '/api/admin/model-reference',
        headers: { cookie: rig.cookie },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().items.length).toBeGreaterThan(0);
      expect(list.json().sync).toHaveLength(1);
      expect(list.json().items[0].region).toBe('global');
      expect(list.json().items[0].scores).toHaveProperty('coding');
      expect(list.json().items[0].scores).toHaveProperty('总分');
      const deepseek = list.json().items.find(
        (item: { normalizedModelName: string }) => item.normalizedModelName === 'deepseek-chat',
      );
      expect(deepseek.provider).toBe('DeepSeek');
      expect(deepseek.scores.coding).toBe(85);

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
      mockRele();
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
