import type { Db } from '../../infrastructure/db/client.js';
import { SettingsRepository } from '../../infrastructure/db/repositories/settings.repository.js';
import type { AdminSettingsRow, AdminSettingsInsert } from '../../infrastructure/db/schema.js';

export class SettingsService {
  constructor(private readonly db: Db) {}

  private repo(): SettingsRepository {
    return new SettingsRepository(this.db);
  }

  async getSettings(): Promise<AdminSettingsRow> {
    return this.repo().seedDefaultSettings();
  }

  async updateSettings(
    data: Partial<Omit<AdminSettingsInsert, 'id' | 'createdAt'>>,
  ): Promise<AdminSettingsRow | undefined> {
    return this.repo().updateSettings(data);
  }
}
