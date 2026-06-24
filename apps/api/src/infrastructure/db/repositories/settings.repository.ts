import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { adminSettings, type AdminSettingsRow, type AdminSettingsInsert } from '../schema.js';

const DEFAULT_SETTINGS_ID = 'default';

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  async getSettings(): Promise<AdminSettingsRow | undefined> {
    const rows = await this.db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.id, DEFAULT_SETTINGS_ID))
      .limit(1);
    return rows[0];
  }

  async seedDefaultSettings(): Promise<AdminSettingsRow> {
    const existing = await this.getSettings();
    if (existing) return existing;
    const now = new Date();
    const row: AdminSettingsInsert = {
      id: DEFAULT_SETTINGS_ID,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(adminSettings).values(row);
    return (await this.getSettings())!;
  }

  async updateSettings(
    data: Partial<Omit<AdminSettingsInsert, 'id' | 'createdAt'>>,
  ): Promise<AdminSettingsRow | undefined> {
    const now = new Date();
    await this.db
      .update(adminSettings)
      .set({ ...data, updatedAt: now })
      .where(eq(adminSettings.id, DEFAULT_SETTINGS_ID));
    return this.getSettings();
  }
}
