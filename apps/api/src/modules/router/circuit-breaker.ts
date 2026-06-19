import { eq, and, lte, sql } from 'drizzle-orm';
import { type Db, adminSettings, circuitBreakers, upstreamKeys } from '../db/index.js';
import type { NormalizedProviderError } from '../providers/types.js';
import { generateId } from '@modelharbor/shared';

export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerSettings {
  circuitBreakerEnabled: boolean;
  circuitBreakerFailureThreshold: number;
  circuitBreakerBaseCooldownMs: number;
  circuitBreakerMaxCooldownMs: number;
  circuitBreakerHalfOpenSuccessCount: number;
  endpointHealthProbeEnabled: boolean;
  endpointHealthProbeIntervalMs: number;
  endpointHealthProbeTimeoutMs: number;
  endpointHealthProbeDegradedLatencyMs: number;
}

const DEFAULT_SETTINGS: CircuitBreakerSettings = {
  circuitBreakerEnabled: true,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerBaseCooldownMs: 60_000,
  circuitBreakerMaxCooldownMs: 600_000,
  circuitBreakerHalfOpenSuccessCount: 2,
  endpointHealthProbeEnabled: true,
  endpointHealthProbeIntervalMs: 3_600_000,
  endpointHealthProbeTimeoutMs: 10_000,
  endpointHealthProbeDegradedLatencyMs: 5_000,
};

const SETTINGS_ID = 'default';

export interface CircuitBreakerTransition {
  previousState: CircuitBreakerState;
  newState: CircuitBreakerState;
  upstreamKeyId: string;
  realModelName: string;
}

export interface CircuitBreakerListItem {
  id: string;
  upstreamKeyId: string;
  upstreamKeyName: string | null;
  realModelName: string;
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  openCount: number;
  openedAt: Date | null;
  cooldownUntil: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: Date;
}

export function computeBackoff(openCount: number, baseMs: number, maxMs: number): number {
  if (openCount <= 0) return baseMs;
  const ms = baseMs * 2 ** (openCount - 1);
  return Math.min(ms, maxMs);
}

export async function getCircuitBreakerSettings(db: Db): Promise<CircuitBreakerSettings> {
  try {
    const row = await db.select().from(adminSettings).where(eq(adminSettings.id, SETTINGS_ID)).get();
    if (row) {
      return {
        circuitBreakerEnabled: row.circuitBreakerEnabled,
        circuitBreakerFailureThreshold: row.circuitBreakerFailureThreshold,
        circuitBreakerBaseCooldownMs: row.circuitBreakerBaseCooldownMs,
        circuitBreakerMaxCooldownMs: row.circuitBreakerMaxCooldownMs,
        circuitBreakerHalfOpenSuccessCount: row.circuitBreakerHalfOpenSuccessCount,
        endpointHealthProbeEnabled: row.endpointHealthProbeEnabled,
        endpointHealthProbeIntervalMs: row.endpointHealthProbeIntervalMs,
        endpointHealthProbeTimeoutMs: row.endpointHealthProbeTimeoutMs,
        endpointHealthProbeDegradedLatencyMs: row.endpointHealthProbeDegradedLatencyMs,
      };
    }
  } catch {
    // fall through to defaults if settings table is not yet available
  }
  return { ...DEFAULT_SETTINGS };
}

export async function ensureDefaultCircuitBreakerSettings(db: Db): Promise<void> {
  const now = new Date();
  try {
    await db
      .insert(adminSettings)
      .values({
        id: SETTINGS_ID,
        ...DEFAULT_SETTINGS,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: adminSettings.id });
  } catch {
    // best-effort
  }
}

export async function updateCircuitBreakerSettings(
  db: Db,
  input: Partial<CircuitBreakerSettings>,
): Promise<CircuitBreakerSettings> {
  const now = new Date();
  const values: Partial<typeof adminSettings.$inferInsert> = {};
  if (typeof input.circuitBreakerEnabled === 'boolean') values.circuitBreakerEnabled = input.circuitBreakerEnabled;
  if (typeof input.circuitBreakerFailureThreshold === 'number') {
    values.circuitBreakerFailureThreshold = Math.max(1, Math.round(input.circuitBreakerFailureThreshold));
  }
  if (typeof input.circuitBreakerBaseCooldownMs === 'number') {
    values.circuitBreakerBaseCooldownMs = Math.max(1000, Math.round(input.circuitBreakerBaseCooldownMs));
  }
  if (typeof input.circuitBreakerMaxCooldownMs === 'number') {
    values.circuitBreakerMaxCooldownMs = Math.max(1000, Math.round(input.circuitBreakerMaxCooldownMs));
  }
  if (typeof input.circuitBreakerHalfOpenSuccessCount === 'number') {
    values.circuitBreakerHalfOpenSuccessCount = Math.max(1, Math.round(input.circuitBreakerHalfOpenSuccessCount));
  }
  if (typeof input.endpointHealthProbeEnabled === 'boolean') {
    values.endpointHealthProbeEnabled = input.endpointHealthProbeEnabled;
  }
  if (typeof input.endpointHealthProbeIntervalMs === 'number') {
    values.endpointHealthProbeIntervalMs = Math.max(60_000, Math.round(input.endpointHealthProbeIntervalMs));
  }
  if (typeof input.endpointHealthProbeTimeoutMs === 'number') {
    values.endpointHealthProbeTimeoutMs = Math.max(1_000, Math.round(input.endpointHealthProbeTimeoutMs));
  }
  if (typeof input.endpointHealthProbeDegradedLatencyMs === 'number') {
    values.endpointHealthProbeDegradedLatencyMs = Math.max(1_000, Math.round(input.endpointHealthProbeDegradedLatencyMs));
  }

  await db
    .insert(adminSettings)
    .values({
      id: SETTINGS_ID,
      ...DEFAULT_SETTINGS,
      ...values,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: adminSettings.id,
      set: { ...values, updatedAt: now },
    });

  return getCircuitBreakerSettings(db);
}

export async function isCircuitBreakerOpen(
  db: Db,
  args: { upstreamKeyId: string; realModelName: string; now: Date; settings: CircuitBreakerSettings },
): Promise<boolean> {
  if (!args.settings.circuitBreakerEnabled) return false;
  try {
    const row = await db
      .select()
      .from(circuitBreakers)
      .where(and(eq(circuitBreakers.upstreamKeyId, args.upstreamKeyId), eq(circuitBreakers.realModelName, args.realModelName)))
      .get();

    if (!row) return false;

    // Auto-transition open -> half_open when cooldown has elapsed.
    if (row.state === 'open' && row.cooldownUntil && row.cooldownUntil.getTime() <= args.now.getTime()) {
      await db
        .update(circuitBreakers)
        .set({
          state: 'half_open',
          successCount: 0,
          failureCount: 0,
          updatedAt: args.now,
        })
        .where(eq(circuitBreakers.id, row.id));
      return false;
    }

    return row.state === 'open';
  } catch {
    return false;
  }
}

export async function recordCircuitBreakerSuccess(
  db: Db,
  args: { upstreamKeyId: string; realModelName: string; now: Date; settings: CircuitBreakerSettings },
): Promise<CircuitBreakerTransition | null> {
  if (!args.settings.circuitBreakerEnabled) return null;
  try {
    const existing = await db
      .select()
      .from(circuitBreakers)
      .where(and(eq(circuitBreakers.upstreamKeyId, args.upstreamKeyId), eq(circuitBreakers.realModelName, args.realModelName)))
      .get();

    if (!existing) return null;

    const previousState = existing.state as CircuitBreakerState;

    if (previousState === 'half_open') {
      const nextSuccessCount = existing.successCount + 1;
      if (nextSuccessCount >= args.settings.circuitBreakerHalfOpenSuccessCount) {
        await db
          .update(circuitBreakers)
          .set({
            state: 'closed',
            failureCount: 0,
            successCount: 0,
            openCount: 0,
            openedAt: null,
            cooldownUntil: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: args.now,
          })
          .where(eq(circuitBreakers.id, existing.id));
        return { previousState, newState: 'closed', upstreamKeyId: args.upstreamKeyId, realModelName: args.realModelName };
      }
      await db
        .update(circuitBreakers)
        .set({ successCount: nextSuccessCount, updatedAt: args.now })
        .where(eq(circuitBreakers.id, existing.id));
      return null;
    }

    if (previousState === 'closed') {
      // A success in closed state resets any accumulated failures so intermittent
      // errors don't accumulate across unrelated requests.
      if (existing.failureCount > 0) {
        await db
          .update(circuitBreakers)
          .set({ failureCount: 0, updatedAt: args.now })
          .where(eq(circuitBreakers.id, existing.id));
      }
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

export async function recordCircuitBreakerFailure(
  db: Db,
  args: {
    upstreamKeyId: string;
    realModelName: string;
    error: NormalizedProviderError;
    now: Date;
    settings: CircuitBreakerSettings;
  },
): Promise<CircuitBreakerTransition | null> {
  if (!args.settings.circuitBreakerEnabled) return null;
  try {
    const existing = await db
      .select()
      .from(circuitBreakers)
      .where(and(eq(circuitBreakers.upstreamKeyId, args.upstreamKeyId), eq(circuitBreakers.realModelName, args.realModelName)))
      .get();

    const id = existing?.id ?? generateId('circuitBreaker');
    const previousState = (existing?.state as CircuitBreakerState) ?? 'closed';

    if (previousState === 'half_open') {
      // Any failure in half_open immediately reopens with exponential backoff.
      const openCount = (existing?.openCount ?? 1) + 1;
      const cooldownMs = computeBackoff(openCount, args.settings.circuitBreakerBaseCooldownMs, args.settings.circuitBreakerMaxCooldownMs);
      const row = {
        state: 'open' as const,
        failureCount: 1,
        successCount: 0,
        openCount,
        openedAt: args.now,
        cooldownUntil: new Date(args.now.getTime() + cooldownMs),
        lastErrorCode: args.error.providerCode ?? args.error.category,
        lastErrorMessage: args.error.providerMessage ?? '',
        updatedAt: args.now,
      };
      if (existing) {
        await db.update(circuitBreakers).set(row).where(eq(circuitBreakers.id, existing.id));
      } else {
        await db.insert(circuitBreakers).values({
          id,
          upstreamKeyId: args.upstreamKeyId,
          realModelName: args.realModelName,
          ...row,
        });
      }
      return { previousState, newState: 'open', upstreamKeyId: args.upstreamKeyId, realModelName: args.realModelName };
    }

    // Closed state: accumulate failures.
    const nextFailureCount = (existing?.failureCount ?? 0) + 1;
    if (nextFailureCount >= args.settings.circuitBreakerFailureThreshold) {
      const openCount = (existing?.openCount ?? 0) + 1;
      const cooldownMs = computeBackoff(openCount, args.settings.circuitBreakerBaseCooldownMs, args.settings.circuitBreakerMaxCooldownMs);
      const row = {
        state: 'open' as const,
        failureCount: nextFailureCount,
        successCount: 0,
        openCount,
        openedAt: args.now,
        cooldownUntil: new Date(args.now.getTime() + cooldownMs),
        lastErrorCode: args.error.providerCode ?? args.error.category,
        lastErrorMessage: args.error.providerMessage ?? '',
        updatedAt: args.now,
      };
      if (existing) {
        await db.update(circuitBreakers).set(row).where(eq(circuitBreakers.id, existing.id));
      } else {
        await db.insert(circuitBreakers).values({
          id,
          upstreamKeyId: args.upstreamKeyId,
          realModelName: args.realModelName,
          ...row,
        });
      }
      return { previousState, newState: 'open', upstreamKeyId: args.upstreamKeyId, realModelName: args.realModelName };
    }

    // Stay closed, just bump failure count.
    if (existing) {
      await db
        .update(circuitBreakers)
        .set({
          failureCount: nextFailureCount,
          lastErrorCode: args.error.providerCode ?? args.error.category,
          lastErrorMessage: args.error.providerMessage ?? '',
          updatedAt: args.now,
        })
        .where(eq(circuitBreakers.id, existing.id));
    } else {
      await db.insert(circuitBreakers).values({
        id,
        upstreamKeyId: args.upstreamKeyId,
        realModelName: args.realModelName,
        state: 'closed',
        failureCount: nextFailureCount,
        successCount: 0,
        openCount: 0,
        lastErrorCode: args.error.providerCode ?? args.error.category,
        lastErrorMessage: args.error.providerMessage ?? '',
        updatedAt: args.now,
      });
    }
    return null;
  } catch {
    return null;
  }
}

export async function resetCircuitBreaker(
  db: Db,
  args: { id: string; now: Date },
): Promise<boolean> {
  try {
    const result = await db
      .update(circuitBreakers)
      .set({
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        openCount: 0,
        openedAt: null,
        cooldownUntil: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: args.now,
      })
      .where(eq(circuitBreakers.id, args.id))
      .run();
    return (result as unknown as { rowsAffected: number }).rowsAffected > 0;
  } catch {
    return false;
  }
}

export async function listCircuitBreakers(
  db: Db,
  args: { limit?: number; state?: CircuitBreakerState },
): Promise<CircuitBreakerListItem[]> {
  try {
    let query = db.select().from(circuitBreakers);
    if (args.state) {
      query = query.where(eq(circuitBreakers.state, args.state)) as typeof query;
    }
    const rows = await query
      .orderBy(sql`${circuitBreakers.updatedAt} DESC`)
      .limit(args.limit ?? 500)
      .all();

    const keyIds = [...new Set(rows.map((r) => r.upstreamKeyId))];
    const keyRows =
      keyIds.length > 0
        ? await db.select({ id: upstreamKeys.id, name: upstreamKeys.name }).from(upstreamKeys).where(sql`${upstreamKeys.id} IN (${keyIds.join(',')})`).all()
        : [];
    const keyNameById = new Map(keyRows.map((k) => [k.id, k.name]));

    return rows.map((r) => ({
      id: r.id,
      upstreamKeyId: r.upstreamKeyId,
      upstreamKeyName: keyNameById.get(r.upstreamKeyId) ?? null,
      realModelName: r.realModelName,
      state: r.state as CircuitBreakerState,
      failureCount: r.failureCount,
      successCount: r.successCount,
      openCount: r.openCount,
      openedAt: r.openedAt,
      cooldownUntil: r.cooldownUntil,
      lastErrorCode: r.lastErrorCode,
      lastErrorMessage: r.lastErrorMessage,
      updatedAt: r.updatedAt,
    }));
  } catch {
    return [];
  }
}

export async function pruneCircuitBreakers(
  db: Db,
  args: { now: Date; retentionDays?: number },
): Promise<number> {
  const cutoff = new Date(args.now.getTime() - (args.retentionDays ?? 30) * 24 * 60 * 60 * 1000);
  try {
    const rows = await db
      .select({ id: circuitBreakers.id })
      .from(circuitBreakers)
      .where(and(eq(circuitBreakers.state, 'closed'), lte(circuitBreakers.updatedAt, cutoff)))
      .all();
    let removed = 0;
    for (const row of rows) {
      try {
        const result = await db.delete(circuitBreakers).where(eq(circuitBreakers.id, row.id)).run();
        removed += (result as unknown as { rowsAffected: number }).rowsAffected;
      } catch {
        // best-effort
      }
    }
    return removed;
  } catch {
    return 0;
  }
}
