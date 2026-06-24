import { eq, and, gt, lt } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  stickyBindings,
  stickySessions,
  circuitBreakers,
  upstreamEndpointHealth,
  type StickyBindingInsert,
  type StickyBindingRow,
  type StickySessionInsert,
  type StickySessionRow,
  type CircuitBreakerInsert,
  type CircuitBreakerRow,
  type UpstreamEndpointHealthInsert,
  type UpstreamEndpointHealthRow,
} from '../schema.js';

export class RoutingStateRepository {
  constructor(private readonly db: Db) {}

  // --- Sticky bindings (conversation level) ---

  async findStickyBinding(
    appId: string,
    consumerKeyId: string,
    requestedTargetName: string,
    conversationFingerprint: string,
    at = new Date(),
  ): Promise<StickyBindingRow | undefined> {
    const rows = await this.db
      .select()
      .from(stickyBindings)
      .where(
        and(
          eq(stickyBindings.appId, appId),
          eq(stickyBindings.consumerKeyId, consumerKeyId),
          eq(stickyBindings.requestedTargetName, requestedTargetName),
          eq(stickyBindings.conversationFingerprint, conversationFingerprint),
          gt(stickyBindings.expiresAt, at),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async upsertStickyBinding(
    data: Omit<StickyBindingInsert, 'id' | 'hitCount' | 'createdAt' | 'updatedAt'>,
  ): Promise<StickyBindingRow> {
    const existing = await this.findStickyBinding(
      data.appId,
      data.consumerKeyId,
      data.requestedTargetName,
      data.conversationFingerprint,
    );
    const now = new Date();
    if (existing) {
      await this.db
        .update(stickyBindings)
        .set({
          upstreamKeyId: data.upstreamKeyId,
          realModelName: data.realModelName,
          hitCount: existing.hitCount + 1,
          lastUsedAt: now,
          expiresAt: data.expiresAt,
          updatedAt: now,
        })
        .where(eq(stickyBindings.id, existing.id));
      return (
        await this.db
          .select()
          .from(stickyBindings)
          .where(eq(stickyBindings.id, existing.id))
          .limit(1)
      )[0]!;
    }
    const row: StickyBindingInsert = {
      id: generateId('stickyBinding'),
      ...data,
      hitCount: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(stickyBindings).values(row);
    return row as StickyBindingRow;
  }

  async deleteExpiredStickyBindings(at = new Date()): Promise<void> {
    await this.db.delete(stickyBindings).where(lt(stickyBindings.expiresAt, at));
  }

  // --- Sticky sessions (consumer key + target level) ---

  async findStickySession(
    consumerKeyId: string,
    requestedTargetName: string,
    at = new Date(),
  ): Promise<StickySessionRow | undefined> {
    const rows = await this.db
      .select()
      .from(stickySessions)
      .where(
        and(
          eq(stickySessions.consumerKeyId, consumerKeyId),
          eq(stickySessions.requestedTargetName, requestedTargetName),
          gt(stickySessions.expiresAt, at),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async upsertStickySession(
    data: Omit<StickySessionInsert, 'id' | 'hitCount' | 'createdAt' | 'updatedAt'>,
  ): Promise<StickySessionRow> {
    const existing = await this.findStickySession(data.consumerKeyId, data.requestedTargetName);
    const now = new Date();
    if (existing) {
      await this.db
        .update(stickySessions)
        .set({
          upstreamKeyId: data.upstreamKeyId,
          realModelName: data.realModelName,
          ttlMs: data.ttlMs,
          hitCount: existing.hitCount + 1,
          lastUsedAt: now,
          expiresAt: data.expiresAt,
          updatedAt: now,
        })
        .where(eq(stickySessions.id, existing.id));
      return (
        await this.db
          .select()
          .from(stickySessions)
          .where(eq(stickySessions.id, existing.id))
          .limit(1)
      )[0]!;
    }
    const row: StickySessionInsert = {
      id: generateId('stickySession'),
      ...data,
      hitCount: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(stickySessions).values(row);
    return row as StickySessionRow;
  }

  async deleteExpiredStickySessions(at = new Date()): Promise<void> {
    await this.db.delete(stickySessions).where(lt(stickySessions.expiresAt, at));
  }

  // --- Circuit breakers ---

  async findBreaker(
    upstreamKeyId: string,
    realModelName: string,
  ): Promise<CircuitBreakerRow | undefined> {
    const rows = await this.db
      .select()
      .from(circuitBreakers)
      .where(
        and(
          eq(circuitBreakers.upstreamKeyId, upstreamKeyId),
          eq(circuitBreakers.realModelName, realModelName),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async upsertBreaker(
    data: Omit<CircuitBreakerInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CircuitBreakerRow> {
    const existing = await this.findBreaker(data.upstreamKeyId, data.realModelName);
    const now = new Date();
    if (existing) {
      await this.db
        .update(circuitBreakers)
        .set({ ...data, updatedAt: now })
        .where(eq(circuitBreakers.id, existing.id));
      return (
        await this.db
          .select()
          .from(circuitBreakers)
          .where(eq(circuitBreakers.id, existing.id))
          .limit(1)
      )[0]!;
    }
    const row: CircuitBreakerInsert = {
      id: generateId('circuitBreaker'),
      ...data,
      updatedAt: now,
    };
    await this.db.insert(circuitBreakers).values(row);
    return row as CircuitBreakerRow;
  }

  async updateBreakerState(
    upstreamKeyId: string,
    realModelName: string,
    state: CircuitBreakerRow['state'],
    patch: Partial<Omit<CircuitBreakerInsert, 'id' | 'upstreamKeyId' | 'realModelName'>>,
  ): Promise<CircuitBreakerRow | undefined> {
    const existing = await this.findBreaker(upstreamKeyId, realModelName);
    if (!existing) return undefined;
    const now = new Date();
    await this.db
      .update(circuitBreakers)
      .set({ state, ...patch, updatedAt: now })
      .where(eq(circuitBreakers.id, existing.id));
    return this.findBreaker(upstreamKeyId, realModelName);
  }

  // --- Endpoint health ---

  async findEndpointHealth(
    upstreamKeyId: string,
    endpointBaseUrl: string,
  ): Promise<UpstreamEndpointHealthRow | undefined> {
    const rows = await this.db
      .select()
      .from(upstreamEndpointHealth)
      .where(
        and(
          eq(upstreamEndpointHealth.upstreamKeyId, upstreamKeyId),
          eq(upstreamEndpointHealth.endpointBaseUrl, endpointBaseUrl),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async upsertEndpointHealth(
    data: Omit<UpstreamEndpointHealthInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<UpstreamEndpointHealthRow> {
    const existing = await this.findEndpointHealth(data.upstreamKeyId, data.endpointBaseUrl);
    const now = new Date();
    if (existing) {
      await this.db
        .update(upstreamEndpointHealth)
        .set({ ...data, updatedAt: now })
        .where(eq(upstreamEndpointHealth.id, existing.id));
      return (
        await this.db
          .select()
          .from(upstreamEndpointHealth)
          .where(eq(upstreamEndpointHealth.id, existing.id))
          .limit(1)
      )[0]!;
    }
    const row: UpstreamEndpointHealthInsert = {
      id: generateId('upstreamEndpointHealth'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(upstreamEndpointHealth).values(row);
    return row as UpstreamEndpointHealthRow;
  }

  async listEndpointHealthByUpstream(upstreamKeyId: string): Promise<UpstreamEndpointHealthRow[]> {
    return this.db
      .select()
      .from(upstreamEndpointHealth)
      .where(eq(upstreamEndpointHealth.upstreamKeyId, upstreamKeyId));
  }
}
