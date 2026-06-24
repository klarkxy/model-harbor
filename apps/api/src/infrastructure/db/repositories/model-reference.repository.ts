import { eq, and, desc } from 'drizzle-orm';
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

  async upsertEntry(data: Omit<ModelReferenceEntryInsert, 'id'>): Promise<ModelReferenceEntryRow> {
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
        })
        .where(eq(modelReferenceEntries.id, existing.id));
      return (await this.findEntry(data.region, data.source, data.normalizedModelName))!;
    }
    const row: ModelReferenceEntryInsert = {
      id: generateId('modelReference'),
      ...data,
    };
    await this.db.insert(modelReferenceEntries).values(row);
    return row as ModelReferenceEntryRow;
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
