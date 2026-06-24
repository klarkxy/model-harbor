import { eq } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import { apps, type AppInsert, type AppRow } from '../schema.js';

export class AppRepository {
  constructor(private readonly db: Db) {}

  async createApp(data: Omit<AppInsert, 'id' | 'createdAt' | 'updatedAt'>): Promise<AppRow> {
    const now = new Date();
    const row: AppInsert = {
      id: generateId('app'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(apps).values(row);
    return row as AppRow;
  }

  async findById(id: string): Promise<AppRow | undefined> {
    const rows = await this.db.select().from(apps).where(eq(apps.id, id)).limit(1);
    return rows[0];
  }

  async findByName(name: string): Promise<AppRow | undefined> {
    const rows = await this.db.select().from(apps).where(eq(apps.name, name)).limit(1);
    return rows[0];
  }

  async listApps(): Promise<AppRow[]> {
    return this.db.select().from(apps).orderBy(apps.name);
  }

  async updateApp(
    id: string,
    data: Partial<Omit<AppInsert, 'id' | 'createdAt'>>,
  ): Promise<AppRow | undefined> {
    const now = new Date();
    await this.db
      .update(apps)
      .set({ ...data, updatedAt: now })
      .where(eq(apps.id, id));
    return this.findById(id);
  }

  async deleteApp(id: string): Promise<void> {
    await this.db.delete(apps).where(eq(apps.id, id));
  }
}
