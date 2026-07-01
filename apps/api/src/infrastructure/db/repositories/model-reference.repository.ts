import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  modelReferenceEntries,
  modelReferenceSyncStatus,
  type ModelReferenceEntryInsert,
  type ModelReferenceEntryRow,
  type ModelReferenceSyncStatusInsert,
  type ModelReferenceSyncStatusRow,
  type ModelReferenceRegion,
  type ModelReferenceSource,
} from '../schema.js';

export class ModelReferenceRepository {
  constructor(private readonly db: Db) {}

  async upsertEntry(
    data: Omit<ModelReferenceEntryInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ModelReferenceEntryRow> {
    const now = new Date();
    const existing = await this.findEntry(data.region, data.source, data.normalizedModelName);
    if (existing) {
      await this.db
        .update(modelReferenceEntries)
        .set({
          sourceModelId: data.sourceModelId,
          displayName: data.displayName,
          provider: data.provider,
          scoresJson: data.scoresJson,
          priceJson: data.priceJson,
          contextWindow: data.contextWindow,
          latencyMs: data.latencyMs,
          speedScore: data.speedScore,
          sourceUrl: data.sourceUrl,
          rawJson: data.rawJson,
          fetchedAt: data.fetchedAt,
          updatedAt: now,
        })
        .where(eq(modelReferenceEntries.id, existing.id));
      return (await this.findEntry(data.region, data.source, data.normalizedModelName))!;
    }
    const row: ModelReferenceEntryInsert = {
      id: generateId('modelReference'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(modelReferenceEntries).values(row);
    return row as ModelReferenceEntryRow;
  }

  async findEntryById(id: string): Promise<ModelReferenceEntryRow | undefined> {
    const rows = await this.db
      .select()
      .from(modelReferenceEntries)
      .where(eq(modelReferenceEntries.id, id))
      .limit(1);
    return rows[0];
  }

  async findEntry(
    region: ModelReferenceRegion,
    source: ModelReferenceSource,
    normalizedModelName: string,
  ): Promise<ModelReferenceEntryRow | undefined> {
    const rows = await this.db
      .select()
      .from(modelReferenceEntries)
      .where(
        and(
          eq(modelReferenceEntries.region, region),
          eq(modelReferenceEntries.source, source),
          eq(modelReferenceEntries.normalizedModelName, normalizedModelName),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async listEntriesByNormalizedName(
    normalizedModelName: string,
  ): Promise<ModelReferenceEntryRow[]> {
    return this.db
      .select()
      .from(modelReferenceEntries)
      .where(eq(modelReferenceEntries.normalizedModelName, normalizedModelName))
      .orderBy(desc(modelReferenceEntries.fetchedAt));
  }

  async listEntriesBySource(
    region: ModelReferenceRegion,
    source: ModelReferenceSource,
  ): Promise<ModelReferenceEntryRow[]> {
    return this.db
      .select()
      .from(modelReferenceEntries)
      .where(
        and(eq(modelReferenceEntries.region, region), eq(modelReferenceEntries.source, source)),
      )
      .orderBy(desc(modelReferenceEntries.fetchedAt));
  }

  async listEntries(options?: {
    region?: ModelReferenceRegion;
    source?: ModelReferenceSource;
    provider?: string;
    sortBy?: 'score' | 'rank' | 'votes' | 'fetchedAt';
    order?: 'asc' | 'desc';
    limit?: number;
  }): Promise<ModelReferenceEntryRow[]> {
    const opts = options ?? {};
    const conditions: ReturnType<typeof eq>[] = [];
    if (opts.region) conditions.push(eq(modelReferenceEntries.region, opts.region));
    if (opts.source) conditions.push(eq(modelReferenceEntries.source, opts.source));
    if (opts.provider) conditions.push(eq(modelReferenceEntries.provider, opts.provider));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const sortColumn =
      opts.sortBy === 'score'
        ? sql`json_extract(${modelReferenceEntries.scoresJson}, '$.arenaElo')`
        : opts.sortBy === 'rank'
          ? sql`json_extract(${modelReferenceEntries.scoresJson}, '$.rank')`
          : opts.sortBy === 'votes'
            ? sql`json_extract(${modelReferenceEntries.scoresJson}, '$.votes')`
            : modelReferenceEntries.fetchedAt;

    const orderFn = opts.order === 'asc' ? asc : desc;

    return this.db
      .select()
      .from(modelReferenceEntries)
      .where(where)
      .orderBy(orderFn(sortColumn))
      .limit(opts.limit ?? 200);
  }

  // --- Sync status ---

  async getSyncStatus(
    region: ModelReferenceRegion,
    source: ModelReferenceSource,
  ): Promise<ModelReferenceSyncStatusRow | undefined> {
    const rows = await this.db
      .select()
      .from(modelReferenceSyncStatus)
      .where(
        and(
          eq(modelReferenceSyncStatus.region, region),
          eq(modelReferenceSyncStatus.source, source),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async upsertSyncStatus(
    data: Omit<ModelReferenceSyncStatusInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ModelReferenceSyncStatusRow> {
    const existing = await this.getSyncStatus(data.region, data.source);
    const now = new Date();
    if (existing) {
      await this.db
        .update(modelReferenceSyncStatus)
        .set({ ...data, updatedAt: now })
        .where(eq(modelReferenceSyncStatus.id, existing.id));
      return (await this.getSyncStatus(data.region, data.source))!;
    }
    const row: ModelReferenceSyncStatusInsert = {
      id: generateId('modelReference'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(modelReferenceSyncStatus).values(row);
    return row as ModelReferenceSyncStatusRow;
  }
}
