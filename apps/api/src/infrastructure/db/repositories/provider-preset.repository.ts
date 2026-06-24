import { eq } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import { listProviderDescriptors, type ProviderDescriptor } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import { providerPresets, type ProviderPresetRow, type ProviderPresetInsert } from '../schema.js';

export interface PresetRow {
  id: string;
  source: 'builtin' | 'local';
  name: string;
  providerType: string;
  descriptorJson: ProviderDescriptor;
  createdAt: Date;
  updatedAt: Date;
}

function mapBuiltin(descriptor: ProviderDescriptor): PresetRow {
  return {
    id: descriptor.id,
    source: 'builtin',
    name: descriptor.metadata.displayName,
    providerType: descriptor.endpoints[0]?.providerType ?? 'openai_compatible',
    descriptorJson: descriptor,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function mapLocal(row: ProviderPresetRow): PresetRow {
  return {
    id: row.id,
    source: row.source,
    name: row.name,
    providerType: row.providerType,
    descriptorJson: row.descriptorJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ProviderPresetRepository {
  constructor(private readonly db: Db) {}

  // 内置 preset 来自共享包，永不落库。
  listBuiltins(): PresetRow[] {
    return listProviderDescriptors().map(mapBuiltin);
  }

  async listLocal(): Promise<PresetRow[]> {
    const rows = await this.db.select().from(providerPresets).orderBy(providerPresets.name);
    return rows.map(mapLocal);
  }

  async listAll(): Promise<PresetRow[]> {
    return [...this.listBuiltins(), ...(await this.listLocal())];
  }

  async findLocalById(id: string): Promise<PresetRow | undefined> {
    const rows = await this.db
      .select()
      .from(providerPresets)
      .where(eq(providerPresets.id, id))
      .limit(1);
    return rows[0] ? mapLocal(rows[0]) : undefined;
  }

  async createLocal(
    data: Omit<ProviderPresetInsert, 'id' | 'source' | 'createdAt' | 'updatedAt'>,
  ): Promise<PresetRow> {
    const now = new Date();
    const row: ProviderPresetInsert = {
      id: generateId('providerPreset'),
      source: 'local',
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(providerPresets).values(row);
    return mapLocal(row as ProviderPresetRow);
  }

  async updateLocal(
    id: string,
    data: Partial<Omit<ProviderPresetInsert, 'id' | 'source' | 'createdAt'>>,
  ): Promise<PresetRow | undefined> {
    const now = new Date();
    await this.db
      .update(providerPresets)
      .set({ ...data, updatedAt: now })
      .where(eq(providerPresets.id, id));
    return this.findLocalById(id);
  }

  async deleteLocal(id: string): Promise<void> {
    await this.db.delete(providerPresets).where(eq(providerPresets.id, id));
  }
}
