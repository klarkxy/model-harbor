import { ObservabilityRepository } from '../infrastructure/db/repositories/observability.repository.js';
import type { Db } from '../infrastructure/db/client.js';
import type { UsageRecordRow } from '../infrastructure/db/schema.js';

export interface UsageSummary {
  requestCount: number;
  successCount: number;
  errorCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  stickyHitCount: number;
  successRate: number;
  stickyHitRate: number;
}

export interface UsageGroupItem {
  id?: string;
  name: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageGroups {
  byApp: UsageGroupItem[];
  byConsumerKey: UsageGroupItem[];
  byUpstream: UsageGroupItem[];
  byTarget: UsageGroupItem[];
}

export interface UsageDashboard {
  summary: UsageSummary;
  groups: UsageGroups;
  recent: UsageRecordRow[];
}

export class UsageService {
  private readonly repo: ObservabilityRepository;

  constructor(private readonly db: Db) {
    this.repo = new ObservabilityRepository(db);
  }

  async getDashboard(since: Date): Promise<UsageDashboard> {
    const [summary, byApp, byConsumerKey, byUpstream, byTarget, recent] = await Promise.all([
      this.repo.getUsageSummary(since),
      this.repo.getUsageGroupByApp(since),
      this.repo.getUsageGroupByConsumerKey(since),
      this.repo.getUsageGroupByUpstream(since),
      this.repo.getUsageGroupByTarget(since),
      this.repo.listRecentUsageRecords(50),
    ]);

    return {
      summary: {
        ...summary,
        successRate: summary.requestCount > 0 ? summary.successCount / summary.requestCount : 0,
        stickyHitRate: summary.requestCount > 0 ? summary.stickyHitCount / summary.requestCount : 0,
      },
      groups: {
        byApp,
        byConsumerKey,
        byUpstream,
        byTarget,
      },
      recent,
    };
  }
}
