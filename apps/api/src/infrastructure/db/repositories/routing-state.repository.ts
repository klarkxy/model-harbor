import { eq, and, gt, lt, inArray, sql } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  stickyBindings,
  stickySessions,
  circuitBreakers,
  type StickyBindingInsert,
  type StickyBindingRow,
  type StickySessionInsert,
  type StickySessionRow,
  type CircuitBreakerInsert,
  type CircuitBreakerRow,
} from '../schema.js';

export class RoutingStateRepository {
  constructor(private readonly db: Db) {}

  // --- Sticky bindings (conversation level) ---

  async findStickyBinding(
    clientId: string,
    clientKeyId: string,
    requestedTargetName: string,
    conversationFingerprint: string,
    at = new Date(),
  ): Promise<StickyBindingRow | undefined> {
    const rows = await this.db
      .select()
      .from(stickyBindings)
      .where(
        and(
          eq(stickyBindings.clientId, clientId),
          eq(stickyBindings.clientKeyId, clientKeyId),
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
      data.clientId,
      data.clientKeyId,
      data.requestedTargetName,
      data.conversationFingerprint,
    );
    const now = new Date();
    if (existing) {
      // 收口 #10：UPDATE 路径也要刷 endpointId，否则 endpoint 重配置后
      // sticky 命中会永远 pin 到旧 endpoint。
      await this.db
        .update(stickyBindings)
        .set({
          providerAccountId: data.providerAccountId,
          endpointId: data.endpointId ?? null,
          realModelName: data.realModelName,
          endpointUrl: data.endpointUrl ?? null,
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

  async listStickyBindings(filters?: {
    clientKeyId?: string;
    requestedTargetName?: string;
  }): Promise<StickyBindingRow[]> {
    const conditions: ReturnType<typeof eq>[] = [];
    if (filters?.clientKeyId) {
      conditions.push(eq(stickyBindings.clientKeyId, filters.clientKeyId));
    }
    if (filters?.requestedTargetName) {
      conditions.push(eq(stickyBindings.requestedTargetName, filters.requestedTargetName));
    }
    if (conditions.length === 0) {
      return this.db.select().from(stickyBindings);
    }
    return this.db
      .select()
      .from(stickyBindings)
      .where(and(...conditions));
  }

  async deleteExpiredStickyBindings(at = new Date()): Promise<void> {
    await this.db.delete(stickyBindings).where(lt(stickyBindings.expiresAt, at));
  }

  // --- Sticky sessions (consumer key + target level) ---

  async findStickySession(
    clientKeyId: string,
    requestedTargetName: string,
    at = new Date(),
  ): Promise<StickySessionRow | undefined> {
    const rows = await this.db
      .select()
      .from(stickySessions)
      .where(
        and(
          eq(stickySessions.clientKeyId, clientKeyId),
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
    const existing = await this.findStickySession(data.clientKeyId, data.requestedTargetName);
    const now = new Date();
    if (existing) {
      // 收口 #10：同 stickyBinding，UPDATE 也要刷 endpointId。
      await this.db
        .update(stickySessions)
        .set({
          providerAccountId: data.providerAccountId,
          endpointId: data.endpointId ?? null,
          realModelName: data.realModelName,
          endpointUrl: data.endpointUrl ?? null,
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

  async listStickySessions(filters?: {
    clientKeyId?: string;
    requestedTargetName?: string;
  }): Promise<StickySessionRow[]> {
    const conditions: ReturnType<typeof eq>[] = [];
    if (filters?.clientKeyId) {
      conditions.push(eq(stickySessions.clientKeyId, filters.clientKeyId));
    }
    if (filters?.requestedTargetName) {
      conditions.push(eq(stickySessions.requestedTargetName, filters.requestedTargetName));
    }
    if (conditions.length === 0) {
      return this.db.select().from(stickySessions);
    }
    return this.db
      .select()
      .from(stickySessions)
      .where(and(...conditions));
  }

  async deleteExpiredStickySessions(at = new Date()): Promise<void> {
    await this.db.delete(stickySessions).where(lt(stickySessions.expiresAt, at));
  }

  // --- Circuit breakers ---

  async listBreakers(): Promise<CircuitBreakerRow[]> {
    return this.db.select().from(circuitBreakers);
  }

  async findBreaker(
    providerAccountId: string,
    endpointId: string,
    realModelName: string,
  ): Promise<CircuitBreakerRow | undefined> {
    // 收口 #9：endpointId 必填。candidate 严格绑定 endpoint，breaker key 必为三元组；
    // 缺 endpointId 的查询会返回错误行，是 bug。
    const rows = await this.db
      .select()
      .from(circuitBreakers)
      .where(
        and(
          eq(circuitBreakers.providerAccountId, providerAccountId),
          eq(circuitBreakers.endpointId, endpointId),
          eq(circuitBreakers.realModelName, realModelName),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async upsertBreaker(
    data: Omit<CircuitBreakerInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CircuitBreakerRow> {
    if (!data.endpointId) {
      throw new Error('upsertBreaker: endpointId is required (v1 candidate 严格绑定 endpoint)');
    }
    const existing = await this.findBreaker(
      data.providerAccountId,
      data.endpointId,
      data.realModelName,
    );
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
    providerAccountId: string,
    endpointId: string,
    realModelName: string,
    state: CircuitBreakerRow['state'],
    patch: Partial<
      Omit<CircuitBreakerInsert, 'id' | 'providerAccountId' | 'realModelName' | 'endpointId'>
    >,
  ): Promise<CircuitBreakerRow | undefined> {
    const existing = await this.findBreaker(providerAccountId, endpointId, realModelName);
    if (!existing) return undefined;
    const now = new Date();
    await this.db
      .update(circuitBreakers)
      .set({ state, ...patch, updatedAt: now })
      .where(eq(circuitBreakers.id, existing.id));
    return this.findBreaker(providerAccountId, endpointId, realModelName);
  }

  /**
   * 原子更新 breaker 的 cooldownUntil / lastError 字段，不动 state/failureCount/openCount。
   * 用于 per-candidate cooldown，避免与并发 breaker 状态转换（closed→open）产生竞争 ——
   * 不需要先读后写（直接用 account+endpoint+model 三元组做原子 UPDATE）。
   */
  async updateBreakerCooldown(
    providerAccountId: string,
    endpointId: string,
    realModelName: string,
    patch: { cooldownUntil: Date; lastErrorCode: string; lastErrorMessage: string },
  ): Promise<boolean> {
    const now = new Date();
    const result = await this.db
      .update(circuitBreakers)
      .set({
        cooldownUntil: patch.cooldownUntil,
        lastErrorCode: patch.lastErrorCode,
        lastErrorMessage: patch.lastErrorMessage,
        updatedAt: now,
      })
      .where(
        and(
          eq(circuitBreakers.providerAccountId, providerAccountId),
          eq(circuitBreakers.endpointId, endpointId),
          eq(circuitBreakers.realModelName, realModelName),
        ),
      )
      .returning({ id: circuitBreakers.id });
    return result.length > 0;
  }

  /**
   * LiteLLM 借鉴：原子累加 per-candidate cooldown 失败窗口计数。
   * - 仅在 breaker 处于 closed / half_open 时计数（open 状态不再累加）。
   * - 若窗口为空或已过期，重置为 1 并记录新窗口起点。
   * - 返回更新后的窗口内失败次数与窗口起点，供调用方判断是否触发 cooldown。
   */
  async incrementCooldownFailureAtomic(
    providerAccountId: string,
    endpointId: string,
    realModelName: string,
    windowMs: number,
    now: Date,
  ): Promise<{ count: number; windowStart: Date }> {
    const nowMs = now.getTime();
    const [updated] = await this.db
      .update(circuitBreakers)
      .set({
        cooldownFailureCount: sql`
          CASE
            WHEN ${circuitBreakers.cooldownFailureWindowStart} IS NULL
              OR ${nowMs} - ${circuitBreakers.cooldownFailureWindowStart} > ${windowMs}
            THEN 1
            ELSE ${circuitBreakers.cooldownFailureCount} + 1
          END
        `,
        cooldownFailureWindowStart: sql`
          CASE
            WHEN ${circuitBreakers.cooldownFailureWindowStart} IS NULL
              OR ${nowMs} - ${circuitBreakers.cooldownFailureWindowStart} > ${windowMs}
            THEN ${nowMs}
            ELSE ${circuitBreakers.cooldownFailureWindowStart}
          END
        `,
        updatedAt: now,
      })
      .where(
        and(
          eq(circuitBreakers.providerAccountId, providerAccountId),
          eq(circuitBreakers.endpointId, endpointId),
          eq(circuitBreakers.realModelName, realModelName),
          inArray(circuitBreakers.state, ['closed', 'half_open']),
        ),
      )
      .returning({
        cooldownFailureCount: circuitBreakers.cooldownFailureCount,
        cooldownFailureWindowStart: circuitBreakers.cooldownFailureWindowStart,
      });

    if (updated) {
      return {
        count: updated.cooldownFailureCount,
        windowStart: updated.cooldownFailureWindowStart as Date,
      };
    }

    // 没有 closed/half_open 行：创建一条 closed 行用于记录 cooldown 窗口。
    await this.upsertBreaker({
      providerAccountId,
      endpointId,
      realModelName,
      state: 'closed',
      failureCount: 0,
      successCount: 0,
      openCount: 0,
      cooldownUntil: null,
      openedAt: null,
      lastErrorCode: 'retriable_failure',
      lastErrorMessage: 'cooldown window started',
      cooldownFailureCount: 1,
      cooldownFailureWindowStart: now,
    });
    return { count: 1, windowStart: now };
  }

  /**
   * 当 candidate 成功响应时重置 cooldown 失败窗口，避免旧失败继续影响该 candidate。
   */
  async resetCooldownFailureWindow(
    providerAccountId: string,
    endpointId: string,
    realModelName: string,
    now: Date,
  ): Promise<void> {
    await this.db
      .update(circuitBreakers)
      .set({
        cooldownFailureCount: 0,
        cooldownFailureWindowStart: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(circuitBreakers.providerAccountId, providerAccountId),
          eq(circuitBreakers.endpointId, endpointId),
          eq(circuitBreakers.realModelName, realModelName),
        ),
      );
  }

  async deleteStaleBreakers(at = new Date()): Promise<void> {
    // 收口 #6：删除条件只要求 state='open' AND cooldownUntil 已过期。
    // 之前同时要求 updatedAt < at-24h 的设计在生产中永远命中不了（每次
    // 失败/成功都刷新 updatedAt），导致 open breaker 永远累积。
    await this.db
      .delete(circuitBreakers)
      .where(and(eq(circuitBreakers.state, 'open'), lt(circuitBreakers.cooldownUntil, at)));
  }

  /**
   * 收口 #5：原子地给 (providerAccountId, endpointId, realModelName) breaker 累加失败次数。
   * - 仅当 breaker 当前 state 处于 closed / half_open 才增加失败计数（OPEN 时不再叠加，
   *   否则 openCount 会无界增长）。
   * - 用 SQL CASE 表达式 + WHERE 条件保证读-改-写在单条 UPDATE 内完成，
   *   避免 Node 异步事件循环与 SQLite 序列化写之间产生的 lost-update。
   * - 返回更新后的 row（无 row 表示没有可更新目标，调用方据此走"创建新 breaker"路径）。
   */
  async incrementBreakerFailureAtomic(
    providerAccountId: string,
    endpointId: string,
    realModelName: string,
    error: { code: string; message: string },
    now: Date,
  ): Promise<CircuitBreakerRow | undefined> {
    const [updated] = await this.db
      .update(circuitBreakers)
      .set({
        failureCount: sql`${circuitBreakers.failureCount} + 1`,
        lastErrorCode: error.code,
        lastErrorMessage: error.message,
        updatedAt: now,
      })
      .where(
        and(
          eq(circuitBreakers.providerAccountId, providerAccountId),
          eq(circuitBreakers.endpointId, endpointId),
          eq(circuitBreakers.realModelName, realModelName),
          inArray(circuitBreakers.state, ['closed', 'half_open']),
        ),
      )
      .returning();
    return updated;
  }

  /**
   * 收口 #5：原子地把 breaker 状态从 currentState 推到 nextState。
   * 用于 open 转换（closed/half_open → open）和 half_open 转换（closed → half_open）等场景。
   * 仅当 row.state 仍为 expectedState 时才更新，避免两次并发失败导致 openCount 错算。
   * 返回 true 表示更新成功，false 表示状态已被其他请求抢先修改。
   */
  async transitionBreakerState(
    providerAccountId: string,
    endpointId: string,
    realModelName: string,
    expectedState: CircuitBreakerRow['state'],
    nextState: CircuitBreakerRow['state'],
    patch: Partial<
      Omit<CircuitBreakerInsert, 'id' | 'providerAccountId' | 'realModelName' | 'endpointId'>
    >,
    now: Date,
  ): Promise<boolean> {
    const result = await this.db
      .update(circuitBreakers)
      .set({ state: nextState, ...patch, updatedAt: now })
      .where(
        and(
          eq(circuitBreakers.providerAccountId, providerAccountId),
          eq(circuitBreakers.endpointId, endpointId),
          eq(circuitBreakers.realModelName, realModelName),
          eq(circuitBreakers.state, expectedState),
        ),
      )
      .returning({ id: circuitBreakers.id });
    return result.length > 0;
  }

  /**
   * 收口 #5：原子地把 breaker 标记为 closed，并清零失败计数。
   * 仅当 row.state 仍为 half_open 时才更新（成功响应只在 half_open 时才闭合熔断器）。
   */
  async closeBreaker(
    providerAccountId: string,
    endpointId: string,
    realModelName: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.db
      .update(circuitBreakers)
      .set({
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        cooldownUntil: null,
        cooldownFailureCount: 0,
        cooldownFailureWindowStart: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(circuitBreakers.providerAccountId, providerAccountId),
          eq(circuitBreakers.endpointId, endpointId),
          eq(circuitBreakers.realModelName, realModelName),
          eq(circuitBreakers.state, 'half_open'),
        ),
      )
      .returning({ id: circuitBreakers.id });
    return result.length > 0;
  }

  /**
   * 收口 #5：原子地把 successCount++ 并清零 failureCount。
   * 仅当 state=half_open 时执行；其他状态由调用方按业务规则决定。
   */
  async incrementBreakerSuccessAtomic(
    providerAccountId: string,
    endpointId: string,
    realModelName: string,
    now: Date,
  ): Promise<CircuitBreakerRow | undefined> {
    const [updated] = await this.db
      .update(circuitBreakers)
      .set({
        successCount: sql`${circuitBreakers.successCount} + 1`,
        failureCount: 0,
        updatedAt: now,
      })
      .where(
        and(
          eq(circuitBreakers.providerAccountId, providerAccountId),
          eq(circuitBreakers.endpointId, endpointId),
          eq(circuitBreakers.realModelName, realModelName),
          eq(circuitBreakers.state, 'half_open'),
        ),
      )
      .returning();
    return updated;
  }
}
