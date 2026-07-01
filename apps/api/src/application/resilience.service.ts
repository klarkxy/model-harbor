import type { Db } from '../infrastructure/db/client.js';
import { RoutingStateRepository } from '../infrastructure/db/repositories/routing-state.repository.js';
import type { CircuitBreakerRow } from '../infrastructure/db/schema.js';

export interface StickyOverview {
  bindings: Awaited<ReturnType<RoutingStateRepository['listStickyBindings']>>;
  sessions: Awaited<ReturnType<RoutingStateRepository['listStickySessions']>>;
}

export class ResilienceService {
  constructor(private readonly db: Db) {}

  private repo(): RoutingStateRepository {
    return new RoutingStateRepository(this.db);
  }

  async listBreakers(): Promise<CircuitBreakerRow[]> {
    return this.repo().listBreakers();
  }

  async resetBreaker(
    providerAccountId: string,
    realModelName: string,
    endpointId: string,
  ): Promise<CircuitBreakerRow> {
    if (!endpointId) {
      throw new Error('resetBreaker: endpointId 是必填参数（v1 candidate 严格绑定 endpoint）');
    }
    const existing = await this.repo().findBreaker(providerAccountId, endpointId, realModelName);
    if (!existing) {
      return this.repo().upsertBreaker({
        providerAccountId,
        endpointId,
        realModelName,
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        openCount: 0,
        cooldownUntil: null,
        cooldownFailureCount: 0,
        cooldownFailureWindowStart: null,
        openedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      });
    }
    const reset = await this.repo().updateBreakerState(
      providerAccountId,
      endpointId,
      realModelName,
      'closed',
      {
        failureCount: 0,
        successCount: 0,
        cooldownUntil: null,
        cooldownFailureCount: 0,
        cooldownFailureWindowStart: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    );
    return reset!;
  }

  async getStickyOverview(filters?: {
    clientKeyId?: string;
    requestedTargetName?: string;
  }): Promise<StickyOverview> {
    const [bindings, sessions] = await Promise.all([
      this.repo().listStickyBindings(filters),
      this.repo().listStickySessions(filters),
    ]);
    return { bindings, sessions };
  }
}
