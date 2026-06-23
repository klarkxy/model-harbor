import { describe, expect, it } from 'vitest';
import { runMaintenancePass } from '../src/modules/jobs/index.js';
import { makeAdminRig } from './helper.js';

describe('maintenance pass', () => {
  it('returns zero counts when there is nothing to prune', async () => {
    const rig = await makeAdminRig();
    try {
      const result = await runMaintenancePass(rig.db, new Date());
      expect(result).toMatchObject({
        countersRemoved: 0,
        stickyRemoved: 0,
        stickySessionsRemoved: 0,
        cooldownsCleared: 0,
        tracesRemoved: 0,
        circuitBreakersRemoved: 0,
        endpointsPruned: 0,
        contentLogsRemoved: 0,
      });
    } finally {
      await rig.close();
    }
  }, 20_000);

  it('clears the cooldownUntil column on upstream keys whose cooldown expired', async () => {
    const rig = await makeAdminRig();
    try {
      // We don't have to go through the full quota gateway; instead we
      // can poke the row directly to verify the cooldown clear pass.
      const { upstreamKeys } = await import('../src/modules/db/index.js');
      const { eq } = await import('drizzle-orm');
      const now = new Date();
      const past = new Date(now.getTime() - 60_000);
      await rig.db.insert(upstreamKeys).values({
        id: 'uk_cooldown',
        name: 'Cooled',
        providerType: 'anthropic_compatible',
        baseUrl: 'https://api.test',
        authType: 'pat',
        apiKeyCiphertext: 'x',
        apiKeyPrefix: 'skp',
        defaultHeaders: null,
        extraHeaders: null,
        extraParams: null,
        endpoints: null,
        supportedModels: null,
        providerPresetId: null,
        displayOrder: 1,
        enabled: true,
        frozen: false,
        frozenReason: null,
        cooldownUntil: past,
        lastHealthStatus: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastUsedAt: null,
        stickySessionTtlMs: 300000,
        createdAt: past,
        updatedAt: past,
      });

      const result = await runMaintenancePass(rig.db, now);
      expect(result.cooldownsCleared).toBeGreaterThanOrEqual(1);

      const row = await rig.db
        .select()
        .from(upstreamKeys)
        .where(eq(upstreamKeys.id, 'uk_cooldown'))
        .get();
      expect(row?.cooldownUntil).toBeNull();
    } finally {
      await rig.close();
    }
  }, 20_000);
});