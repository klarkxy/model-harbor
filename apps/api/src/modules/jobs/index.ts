// Background jobs (M6+).
//
// A small set of periodic maintenance tasks. The MVP runs them on a
// setInterval; admins can also trigger the same pass on demand via
// POST /api/admin/maintenance/run. The jobs are:
//
//   * quota reset: drop counter rows whose period window has ended.
//   * sticky cleanup: drop sticky bindings whose TTL has passed.
//   * cooldown cleanup: clear upstream keys whose cooldown has expired
//     (cooldown state lives on the upstream key row).
//
// Each job is a no-op when there is nothing to do. Errors are logged and
// swallowed so one bad job does not crash the loop.

import type { Db } from '../db/index.js';
import { eq, lte } from 'drizzle-orm';
import { upstreamKeys } from '../db/index.js';
import { resetExpiredCounters } from '../quota/index.js';
import { pruneExpiredStickyBindings } from '../sticky/index.js';

import { pruneTraceLogs } from '../observability/index.js';

export interface JobResult {
  countersRemoved: number;
  stickyRemoved: number;
  cooldownsCleared: number;
  tracesRemoved: number;
}

export async function runMaintenancePass(db: Db, now: Date = new Date()): Promise<JobResult> {
  const countersRemoved = await resetExpiredCounters(db, now);
  const stickyRemoved = await pruneExpiredStickyBindings(db, now);
  const tracesRemoved = await pruneTraceLogs(db, { now });
  // Cooldowns whose `cooldownUntil` is in the past get nulled out so the row
  // is no longer filtered as cooled-down. The candidate filter already
  // checks the timestamp, but keeping the row tidy makes the dashboard
  // and the API response read correctly.
  const cooledRows = await db
    .select()
    .from(upstreamKeys)
    .where(lte(upstreamKeys.cooldownUntil, now))
    .all();
  let cooldownsCleared = 0;
  for (const r of cooledRows) {
    if (r.cooldownUntil === null) continue;
    try {
      await db
        .update(upstreamKeys)
        .set({ cooldownUntil: null, updatedAt: now })
        .where(eq(upstreamKeys.id, r.id));
      cooldownsCleared += 1;
    } catch {
      /* ignore */
    }
  }
  return { countersRemoved, stickyRemoved, cooldownsCleared, tracesRemoved };
}

export interface BackgroundJobsHandle {
  stop(): void;
}

// Start a background loop that calls runMaintenancePass every `intervalMs`.
// Returns a handle with a stop() method. The handle is exported but not
// wired into server bootstrap by default; operators opt in via env or config
// in a future milestone.
export function startBackgroundJobs(
  db: Db,
  args: { intervalMs?: number; now?: () => Date } = {},
): BackgroundJobsHandle {
  const interval = args.intervalMs ?? 5 * 60 * 1000;
  const now = args.now ?? (() => new Date());
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await runMaintenancePass(db, now());
    } catch {
      /* swallow */
    }
  };
  const handle = setInterval(() => {
    void tick();
  }, interval);
  return {
    stop(): void {
      stopped = true;
      clearInterval(handle);
    },
  };
}
