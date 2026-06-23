import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeAdminRig, seedFullRoute } from './helper.js';
import {
  getConsumptionStats,
  getDailyConsumptionSummary,
  upsertConsumptionStats,
} from '../src/modules/observability/consumption-stats.js';
import { modelConsumptionStats } from '../src/modules/db/index.js';

const baseDelta = {
  requestCount: 1,
  successCount: 1,
  errorCount: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  latencyMs: 100,
};

describe('consumption stats', () => {
  it('upserts a fresh row and then accumulates the existing row', async () => {
    const rig = await makeAdminRig();
    try {
      const refs = await seedFullRoute(rig);
      const now = new Date('2026-06-23T12:00:00.000Z');

      // First upsert creates a new row.
      await upsertConsumptionStats(rig.db, {
        upstreamKeyId: refs.upstreamKeyId,
        realModelName: 'ds-v4-flash',
        delta: baseDelta,
        now,
      });
      let rows = await rig.db
        .select()
        .from(modelConsumptionStats)
        .where(eq(modelConsumptionStats.upstreamKeyId, refs.upstreamKeyId))
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        upstreamKeyId: refs.upstreamKeyId,
        realModelName: 'ds-v4-flash',
        requestCount: 1,
        successCount: 1,
        errorCount: 0,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        avgLatencyMs: 100,
      });

      // Second upsert with a different latency updates the average using
      // a request-weighted mean: (100*1 + 300*2) / 3 = ~233ms. The delta
      // has requestCount=2 with one success and one error, so successCount
      // becomes 1 + 1 = 2 and errorCount becomes 0 + 1 = 1.
      await upsertConsumptionStats(rig.db, {
        upstreamKeyId: refs.upstreamKeyId,
        realModelName: 'ds-v4-flash',
        delta: { ...baseDelta, requestCount: 2, successCount: 1, errorCount: 1, inputTokens: 5, latencyMs: 300 },
        now,
      });
      rows = await rig.db
        .select()
        .from(modelConsumptionStats)
        .where(eq(modelConsumptionStats.upstreamKeyId, refs.upstreamKeyId))
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        requestCount: 3,
        successCount: 2,
        errorCount: 1,
        inputTokens: 15,
        outputTokens: 40,
        totalTokens: 60,
        avgLatencyMs: Math.round((100 * 1 + 300 * 2) / 3),
      });
    } finally {
      await rig.close();
    }
  }, 20_000);

  it('filters by upstreamKeyId / dayDate / since-until when listing', async () => {
    const rig = await makeAdminRig();
    try {
      const refs = await seedFullRoute(rig);
      const d1 = new Date('2026-06-21T00:00:00.000Z');
      const d2 = new Date('2026-06-22T00:00:00.000Z');
      const d3 = new Date('2026-06-23T00:00:00.000Z');

      for (const now of [d1, d2, d3]) {
        await upsertConsumptionStats(rig.db, {
          upstreamKeyId: refs.upstreamKeyId,
          realModelName: 'ds-v4-flash',
          delta: baseDelta,
          now,
        });
      }

      const all = await getConsumptionStats(rig.db, { limit: 10 });
      expect(all).toHaveLength(3);
      // Newest day first.
      expect(all[0]?.dayDate).toBe('2026-06-23');
      expect(all[1]?.dayDate).toBe('2026-06-22');
      expect(all[2]?.dayDate).toBe('2026-06-21');

      const onlyDay22 = await getConsumptionStats(rig.db, {
        upstreamKeyId: refs.upstreamKeyId,
        dayDate: '2026-06-22',
      });
      expect(onlyDay22).toHaveLength(1);
      expect(onlyDay22[0]?.dayDate).toBe('2026-06-22');

      const sinceDay22 = await getConsumptionStats(rig.db, {
        upstreamKeyId: refs.upstreamKeyId,
        since: d2,
      });
      expect(sinceDay22.map((r) => r.dayDate).sort()).toEqual(['2026-06-22', '2026-06-23']);

      const untilDay22 = await getConsumptionStats(rig.db, {
        upstreamKeyId: refs.upstreamKeyId,
        until: d2,
      });
      expect(untilDay22.map((r) => r.dayDate).sort()).toEqual(['2026-06-21', '2026-06-22']);
    } finally {
      await rig.close();
    }
  }, 20_000);

  it('returns a daily summary aggregating across upstream keys and models', async () => {
    const rig = await makeAdminRig();
    try {
      const refs = await seedFullRoute(rig);
      const day = new Date('2026-06-23T00:00:00.000Z');

      // Two rows on the same day for the same upstream key (different models).
      await upsertConsumptionStats(rig.db, {
        upstreamKeyId: refs.upstreamKeyId,
        realModelName: 'ds-v4-flash',
        delta: baseDelta,
        now: day,
      });
      await upsertConsumptionStats(rig.db, {
        upstreamKeyId: refs.upstreamKeyId,
        realModelName: 'minimax-m3',
        delta: { ...baseDelta, inputTokens: 4, outputTokens: 6, totalTokens: 10 },
        now: day,
      });

      const summary = await getDailyConsumptionSummary(rig.db, {});
      expect(summary).toHaveLength(1);
      expect(summary[0]).toMatchObject({
        dayDate: '2026-06-23',
        totalRequests: 2,
        totalInputTokens: 14,
        totalOutputTokens: 26,
        totalTotalTokens: 40,
      });

      // No data on a different day.
      const empty = await getDailyConsumptionSummary(rig.db, {
        since: new Date('2026-06-24T00:00:00.000Z'),
      });
      expect(empty).toEqual([]);
    } finally {
      await rig.close();
    }
  }, 20_000);
});