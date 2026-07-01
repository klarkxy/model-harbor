import type { Db } from '../infrastructure/db/client.js';
import { ObservabilityRepository } from '../infrastructure/db/repositories/observability.repository.js';

export class DebugContentService {
  constructor(private readonly db: Db) {}

  private repo(): ObservabilityRepository {
    return new ObservabilityRepository(this.db);
  }

  async listRecentLogs(
    limit: number,
  ): Promise<Awaited<ReturnType<ObservabilityRepository['listRecentDebugContentLogs']>>> {
    return this.repo().listRecentDebugContentLogs(limit);
  }

  async getLogByTraceId(
    traceId: string,
  ): Promise<Awaited<ReturnType<ObservabilityRepository['findDebugContentLogByTraceId']>>> {
    return this.repo().findDebugContentLogByTraceId(traceId);
  }
}
