import { eq, desc } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import { backups, type BackupInsert, type BackupRow, type BackupType } from '../schema.js';

export class BackupRepository {
  constructor(private readonly db: Db) {}

  async createBackup(data: Omit<BackupInsert, 'id' | 'createdAt'>): Promise<BackupRow> {
    const row: BackupInsert = {
      id: generateId('backup'),
      ...data,
      createdAt: new Date(),
    };
    await this.db.insert(backups).values(row);
    return row as BackupRow;
  }

  async findById(id: string): Promise<BackupRow | undefined> {
    const rows = await this.db.select().from(backups).where(eq(backups.id, id)).limit(1);
    return rows[0];
  }

  async listBackups(type?: BackupType): Promise<BackupRow[]> {
    if (type) {
      return this.db
        .select()
        .from(backups)
        .where(eq(backups.type, type))
        .orderBy(desc(backups.createdAt));
    }
    return this.db.select().from(backups).orderBy(desc(backups.createdAt));
  }

  async deleteBackup(id: string): Promise<void> {
    await this.db.delete(backups).where(eq(backups.id, id));
  }
}
