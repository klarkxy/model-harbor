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
  costAmount: number;
  costCurrency: string | null;
  unpricedCount: number;
}

export interface UsageGroupItem {
  id?: string;
  name: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costAmount: number;
  costCurrency: string | null;
  unpricedCount: number;
}

export interface UsageGroups {
  byClient: UsageGroupItem[];
  byClientKey: UsageGroupItem[];
  byProviderAccount: UsageGroupItem[];
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
    const [summary, byClient, byClientKey, byProviderAccount, byTarget, recent] = await Promise.all(
      [
        this.repo.getUsageSummary(since),
        this.repo.getUsageGroupByClient(since),
        this.repo.getUsageGroupByClientKey(since),
        this.repo.getUsageGroupByProviderAccount(since),
        this.repo.getUsageGroupByTarget(since),
        this.repo.listRecentUsageRecords(50),
      ],
    );

    return {
      summary: {
        ...summary,
        successRate: summary.requestCount > 0 ? summary.successCount / summary.requestCount : 0,
        stickyHitRate: summary.requestCount > 0 ? summary.stickyHitCount / summary.requestCount : 0,
      },
      groups: {
        byClient,
        byClientKey,
        byProviderAccount,
        byTarget,
      },
      recent,
    };
  }

  async getDailyStatsByDay(
    dayDate: string,
  ): Promise<Awaited<ReturnType<ObservabilityRepository['listDailyStatsByDay']>>> {
    return this.repo.listDailyStatsByDay(dayDate);
  }
}
