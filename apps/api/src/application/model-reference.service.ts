import { ModelReferenceRepository } from '../infrastructure/db/repositories/model-reference.repository.js';
import { TargetRepository } from '../infrastructure/db/repositories/target.repository.js';
import { EndpointRepository } from '../infrastructure/db/repositories/endpoint.repository.js';
import { ArenaModelReferenceClient } from '../infrastructure/model-reference/arena-client.js';
import type { Db } from '../infrastructure/db/client.js';
import type {
  ModelReferenceEntryRow,
  ModelReferenceRegion,
  ModelReferenceSource,
} from '../infrastructure/db/schema.js';

export interface ListModelReferenceQuery {
  region?: ModelReferenceRegion;
  source?: ModelReferenceSource;
  provider?: string;
  sortBy?: 'score' | 'rank' | 'votes' | 'fetchedAt';
  order?: 'asc' | 'desc';
  limit?: number;
}

export interface RecommendDraftInput {
  entryIds: string[];
  providerAccountId?: string;
  createGroup: boolean;
  groupName?: string;
}

export interface DraftModel {
  name: string;
  displayName: string;
  description: string;
  candidates: Array<{
    providerAccountId: string;
    endpointId: string;
    realModelName: string;
    priority: number;
    enabled: boolean;
  }>;
  nameConflict: boolean;
}

export interface DraftChannel {
  name: string;
  displayName: string;
  description: string;
  members: Array<{ modelName: string; priority: number; enabled: boolean }>;
  nameConflict: boolean;
}

export interface RecommendDraftOutput {
  models: DraftModel[];
  channel?: DraftChannel;
  conflicts: string[];
}

export class ModelReferenceService {
  private readonly repo: ModelReferenceRepository;
  private readonly targetRepo: TargetRepository;
  private readonly endpointRepo: EndpointRepository;
  private readonly client: ArenaModelReferenceClient;

  constructor(
    private readonly db: Db,
    client?: ArenaModelReferenceClient,
  ) {
    this.repo = new ModelReferenceRepository(db);
    this.targetRepo = new TargetRepository(db);
    this.endpointRepo = new EndpointRepository(db);
    this.client = client ?? new ArenaModelReferenceClient();
  }

  async listEntries(query: ListModelReferenceQuery): Promise<ModelReferenceEntryRow[]> {
    return this.repo.listEntries(query);
  }

  async getSyncStatus(region: ModelReferenceRegion, source: ModelReferenceSource) {
    return this.repo.getSyncStatus(region, source);
  }

  async refresh(
    region: ModelReferenceRegion,
    source: ModelReferenceSource,
    force = false,
  ): Promise<{ success: boolean; error?: string }> {
    const now = new Date();
    const status = await this.repo.getSyncStatus(region, source);
    const ttlMs = status?.ttlMs ?? 86_400_000;

    if (
      !force &&
      status?.status === 'success' &&
      status.nextRefreshAfter &&
      status.nextRefreshAfter > now
    ) {
      return { success: true };
    }

    await this.repo.upsertSyncStatus({
      region,
      source,
      status: 'refreshing',
      lastRefreshAt: status?.lastRefreshAt,
      nextRefreshAfter: status?.nextRefreshAfter,
      lastError: undefined,
      ttlMs,
    });

    try {
      const entries = await this.client.fetch(region);
      for (const entry of entries) {
        await this.repo.upsertEntry(entry);
      }
      await this.repo.upsertSyncStatus({
        region,
        source,
        status: 'success',
        lastRefreshAt: now,
        nextRefreshAfter: new Date(now.getTime() + ttlMs),
        lastError: undefined,
        ttlMs,
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.upsertSyncStatus({
        region,
        source,
        status: 'error',
        lastRefreshAt: status?.lastRefreshAt,
        nextRefreshAfter: status?.nextRefreshAfter,
        lastError: message,
        ttlMs,
      });
      return { success: false, error: message };
    }
  }

  async recommendDraft(input: RecommendDraftInput): Promise<RecommendDraftOutput> {
    const entries: ModelReferenceEntryRow[] = [];
    for (const id of input.entryIds) {
      const entry = await this.repo.findEntryById(id);
      if (entry) entries.push(entry);
    }

    const conflicts: string[] = [];
    const models: DraftModel[] = [];

    let endpointId: string | null = null;
    if (input.providerAccountId) {
      const endpoints = await this.endpointRepo.listByProviderAccount(input.providerAccountId);
      if (endpoints.length === 0) {
        // 推荐 candidate 时如果该 account 还没有 endpoint，跳过生成 candidate；
        // 让用户先去 Providers 页创建 endpoint 再回来。
        endpointId = null;
      } else {
        endpointId = endpoints[0]!.id;
      }
    }

    for (const entry of entries) {
      const name = entry.normalizedModelName;
      const existing = await this.targetRepo.findByName(name);
      const nameConflict = !!existing;
      if (nameConflict) conflicts.push(name);

      const description = `Provider: ${entry.provider ?? 'unknown'} · Elo: ${entry.scoresJson.arenaElo ?? '-'} · Rank: ${entry.scoresJson.rank ?? '-'} · Votes: ${entry.scoresJson.votes ?? '-'}`;

      models.push({
        name,
        displayName: entry.displayName,
        description,
        candidates:
          input.providerAccountId && endpointId
            ? [
                {
                  providerAccountId: input.providerAccountId,
                  endpointId,
                  realModelName: entry.sourceModelId,
                  priority: 100,
                  enabled: true,
                },
              ]
            : [],
        nameConflict,
      });
    }

    let channel: DraftChannel | undefined;
    if (input.createGroup && entries.length > 0) {
      const first = entries[0]!;
      const channelName = (
        input.groupName?.trim() || `${first.normalizedModelName}-group`
      ).toLowerCase();
      const existingChannel = await this.targetRepo.findByName(channelName);
      const nameConflict = !!existingChannel;
      if (nameConflict) conflicts.push(channelName);

      channel = {
        name: channelName,
        displayName: channelName,
        description: `Recommended channel from ${entries.length} arena entries`,
        members: models.map((m) => ({
          modelName: m.name,
          priority: 100,
          enabled: true,
        })),
        nameConflict,
      };
    }

    return { models, channel, conflicts };
  }
}
