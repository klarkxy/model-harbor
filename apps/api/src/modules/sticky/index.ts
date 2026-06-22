// Sticky routing (M6).
//
// The router engine calls this module once per gateway request, before
// candidate selection, to look up an existing sticky binding for the
// (app, consumer key, model, conversation) tuple. If the bound upstream key is
// still a valid candidate (enabled, not frozen, not cooled down, not over
// quota), the binding is honored and the bound candidate is used directly,
// bypassing the priority policy. Otherwise the router picks a new candidate
// and writes a new binding (or updates the existing one).
//
// Sticky is a weak guarantee: the binding is invalidated as soon as the bound
// candidate becomes unavailable. The hit counter on the binding is what the
// M7 dashboard will use to compute the sticky hit rate.

import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { generateId } from '@modelharbor/shared';
import type { Db } from '../db/index.js';
import { type StickyBindingRow, stickyBindings } from '../db/tables/routing.js';
import type { ResolvedCandidate } from '../router/candidates.js';

// Conversation fingerprint. Derived from a stable prefix of the IR (system +
// first few messages, plus the requested model and the user_id metadata if
// present). The hash is short (16 hex chars) so it fits comfortably in a
// unique index. Clients do not pass any sticky-specific header; the gateway
// infers stickiness from the request shape alone.
export function conversationFingerprint(args: {
  requestedModel: string;
  system: string | null;
  messages: Array<{ role: string; content: string }>;
  metadataUserId?: string | null;
}): string {
  const systemPart = args.system ?? '';
  const msgPart = args.messages
    .slice(0, 4)
    .map((m) => `${m.role}:${m.content}`)
    .join('\n');
  const userPart = args.metadataUserId ?? '';
  const basis = `${args.requestedModel}\nSYS:${systemPart}\n${msgPart}\nUSER:${userPart}`;
  return createHash('sha256').update(basis, 'utf8').digest('hex').slice(0, 16);
}

// How long a binding is honored for, regardless of whether it keeps being hit.
// The 1h default matches the MVP brief; admins can override per-call.
export const DEFAULT_STICKY_TTL_MS = 60 * 60 * 1000;

export interface StickyLookupResult {
  binding: StickyBindingRow | null;
  hit: boolean;
}

export interface StickyLookupInput {
  appId: string;
  consumerKeyId: string;
  requestedTargetName: string;
  fingerprint: string;
  now: Date;
}

// Look up the binding row (if any) and report whether it is fresh enough to
// honor. Stale bindings (expiresAt in the past) are returned as the binding
// but with hit=false; the caller may choose to update the row.
export async function lookupStickyBinding(
  db: Db,
  args: StickyLookupInput,
): Promise<StickyLookupResult> {
  const row = await db
    .select()
    .from(stickyBindings)
    .where(
      and(
        eq(stickyBindings.appId, args.appId),
        eq(stickyBindings.consumerKeyId, args.consumerKeyId),
        eq(stickyBindings.requestedTargetName, args.requestedTargetName),
        eq(stickyBindings.conversationFingerprint, args.fingerprint),
      ),
    )
    .get();
  if (!row) return { binding: null, hit: false };
  return { binding: row, hit: row.expiresAt.getTime() > args.now.getTime() };
}

// Check whether the bound candidate is still a valid candidate in the current
// accepted set. Used to decide whether a fresh binding can be honored.
export function isStickyBindingValid(
  binding: StickyBindingRow,
  accepted: ResolvedCandidate[],
  args: { now: Date },
): boolean {
  const c = accepted.find(
    (x) => x.upstreamKeyId === binding.upstreamKeyId && x.realModelName === binding.realModelName,
  );
  if (!c) return false;
  if (!c.upstreamEnabled) return false;
  if (c.upstreamFrozen) return false;
  if (c.cooldownUntil instanceof Date && c.cooldownUntil.getTime() > args.now.getTime()) {
    return false;
  }
  return true;
}

export interface StickyUpsertInput {
  appId: string;
  consumerKeyId: string;
  requestedTargetName: string;
  fingerprint: string;
  upstreamKeyId: string;
  realModelName: string;
  now: Date;
  ttlMs?: number;
}

// Create a new binding or update the existing one for this tuple. Bumps the
// hit counter and sliding expiresAt. Best-effort: never throws.
//
// The upsert is a single INSERT ... ON CONFLICT DO UPDATE statement so the
// hit counter increments atomically (the previous read-then-update pattern
// lost increments under bursty concurrent writes for the same tuple).
export async function upsertStickyBinding(
  db: Db,
  args: StickyUpsertInput,
): Promise<StickyBindingRow | null> {
  try {
    const ttl = args.ttlMs ?? DEFAULT_STICKY_TTL_MS;
    const id = generateId('stickyBinding');
    const expires = new Date(args.now.getTime() + ttl);
    await db
      .insert(stickyBindings)
      .values({
        id,
        appId: args.appId,
        consumerKeyId: args.consumerKeyId,
        requestedTargetName: args.requestedTargetName,
        conversationFingerprint: args.fingerprint,
        upstreamKeyId: args.upstreamKeyId,
        realModelName: args.realModelName,
        hitCount: 1,
        lastUsedAt: args.now,
        expiresAt: expires,
        createdAt: args.now,
        updatedAt: args.now,
      })
      .onConflictDoUpdate({
        target: [
          stickyBindings.appId,
          stickyBindings.consumerKeyId,
          stickyBindings.requestedTargetName,
          stickyBindings.conversationFingerprint,
        ],
        set: {
          upstreamKeyId: args.upstreamKeyId,
          realModelName: args.realModelName,
          hitCount: sql`${stickyBindings.hitCount} + 1`,
          lastUsedAt: args.now,
          expiresAt: expires,
          updatedAt: args.now,
        },
      });

    // Re-read the persisted row so the caller sees the authoritative
    // post-upsert hit count instead of the optimistic value we wrote.
    const row = await db
      .select()
      .from(stickyBindings)
      .where(
        and(
          eq(stickyBindings.appId, args.appId),
          eq(stickyBindings.consumerKeyId, args.consumerKeyId),
          eq(stickyBindings.requestedTargetName, args.requestedTargetName),
          eq(stickyBindings.conversationFingerprint, args.fingerprint),
        ),
      )
      .get();
    return row ?? null;
  } catch {
    return null;
  }
}

// Touch only the hit counter and expiresAt. Used when the router honors an
// existing binding without changing which upstream it points to.
//
// The increment is a single UPDATE ... SET hitCount = hitCount + 1, so two
// concurrent touches cannot lose increments the way the previous
// read-then-write pattern could.
export async function touchStickyBinding(
  db: Db,
  args: { id: string; now: Date; ttlMs?: number },
): Promise<void> {
  try {
    const ttl = args.ttlMs ?? DEFAULT_STICKY_TTL_MS;
    const expires = new Date(args.now.getTime() + ttl);
    await db
      .update(stickyBindings)
      .set({
        hitCount: sql`${stickyBindings.hitCount} + 1`,
        lastUsedAt: args.now,
        expiresAt: expires,
        updatedAt: args.now,
      })
      .where(eq(stickyBindings.id, args.id));
  } catch {
    /* ignore */
  }
}

// Drop expired bindings. Called by the jobs runner. Returns the number removed.
export async function pruneExpiredStickyBindings(db: Db, now: Date): Promise<number> {
  // SQLite / Drizzle don't have a clean "delete where lte" without a subquery
  // in this driver version, so we iterate. We only delete the rows whose
  // `expiresAt` has elapsed; live bindings (including those that just had
  // their TTL refreshed by a hit) are preserved.
  const all = await db.select().from(stickyBindings).all();
  let removed = 0;
  for (const r of all) {
    if (r.expiresAt.getTime() <= now.getTime()) {
      try {
        await db.delete(stickyBindings).where(eq(stickyBindings.id, r.id));
        removed += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

// Read all bindings for an (app, consumer key) pair. Used by the dashboard.
export async function listStickyBindingsForConsumer(
  db: Db,
  args: { appId: string; consumerKeyId: string },
): Promise<StickyBindingRow[]> {
  return await db
    .select()
    .from(stickyBindings)
    .where(
      and(
        eq(stickyBindings.appId, args.appId),
        eq(stickyBindings.consumerKeyId, args.consumerKeyId),
      ),
    )
    .all();
}
