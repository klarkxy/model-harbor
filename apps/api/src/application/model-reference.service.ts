import { ModelReferenceRepository } from '../infrastructure/db/repositories/model-reference.repository.js';
import { TargetRepository } from '../infrastructure/db/repositories/target.repository.js';
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
  upstreamKeyId?: string;
  createGroup: boolean;
  groupName?: string;
}

export interface DraftPublicModel {
  name: string;
  displayName: string;
  description: string;
  candidates: Array<{
    upstreamKeyId: string;
    realModelName: string;
    priority: number;
    weight: number;
    enabled: boolean;
  }>;
  nameConflict: boolean;
}

export interface DraftModelGroup {
  name: string;
  displayName: string;
  description: string;
  members: Array<{ publicModelName: string; priority: number; weight: number; enabled: boolean }>;
  nameConflict: boolean;
}

export interface RecommendDraftOutput {
  publicModels: DraftPublicModel[];
  modelGroup?: DraftModelGroup;
  conflicts: string[];
}

export class ModelReferenceService {
  private readonly repo: ModelReferenceRepository;
  private readonly targetRepo: TargetRepository;
  private readonly client: ArenaModelReferenceClient;

  constructor(
    private readonly db: Db,
    client?: ArenaModelReferenceClient,
  ) {
    this.repo = new ModelReferenceRepository(db);
    this.targetRepo = new TargetRepository(db);
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
    const publicModels: DraftPublicModel[] = [];

    for (const entry of entries) {
      const name = entry.normalizedModelName;
      const existing = await this.targetRepo.findByName(name);
      const nameConflict = !!existing;
      if (nameConflict) conflicts.push(name);

      const description = `Provider: ${entry.provider ?? 'unknown'} · Elo: ${entry.scoresJson.arenaElo ?? '-'} · Rank: ${entry.scoresJson.rank ?? '-'} · Votes: ${entry.scoresJson.votes ?? '-'}`;

      publicModels.push({
        name,
        displayName: entry.displayName,
        description,
        candidates: input.upstreamKeyId
          ? [
              {
                upstreamKeyId: input.upstreamKeyId,
                realModelName: entry.sourceModelId,
                priority: 100,
                weight: 1,
                enabled: true,
              },
            ]
          : [],
        nameConflict,
      });
    }

    let modelGroup: DraftModelGroup | undefined;
    if (input.createGroup && entries.length > 0) {
      const first = entries[0]!;
      const groupName = (
        input.groupName?.trim() || `${first.normalizedModelName}-group`
      ).toLowerCase();
      const existingGroup = await this.targetRepo.findByName(groupName);
      const nameConflict = !!existingGroup;
      if (nameConflict) conflicts.push(groupName);

      modelGroup = {
        name: groupName,
        displayName: groupName,
        description: `Recommended group from ${entries.length} arena entries`,
        members: publicModels.map((m) => ({
          publicModelName: m.name,
          priority: 100,
          weight: 1,
          enabled: true,
        })),
        nameConflict,
      };
    }

    return { publicModels, modelGroup, conflicts };
  }
}
