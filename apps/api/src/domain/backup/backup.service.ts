import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { BackupRepository } from '../../infrastructure/db/repositories/backup.repository.js';
import { restoreSnapshot } from '../backups/backup.service.js';
import { UpstreamKeyRepository } from '../../infrastructure/db/repositories/upstream-key.repository.js';
import { PublicModelRepository } from '../../infrastructure/db/repositories/public-model.repository.js';
import { ModelGroupRepository } from '../../infrastructure/db/repositories/model-group.repository.js';
import { AppRepository } from '../../infrastructure/db/repositories/app.repository.js';
import type { Db } from '../../infrastructure/db/client.js';
import type { BackupType } from '../../infrastructure/db/schema.js';

export interface BackupServiceDeps {
  db: Db;
  client?: { close(): void | Promise<void> };
  dbFilePath: string;
  backupsDir: string;
}

export class BackupService {
  constructor(private readonly deps: BackupServiceDeps) {}

  private repo(): BackupRepository {
    return new BackupRepository(this.deps.db);
  }

  async listBackups(type?: BackupType) {
    return this.repo().listBackups(type);
  }

  async createBackup(type: BackupType = 'full', note?: string) {
    if (this.deps.dbFilePath === ':memory:') {
      throw new Error('内存数据库不支持备份');
    }
    if (!existsSync(this.deps.backupsDir)) {
      mkdirSync(this.deps.backupsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${type}-${timestamp}.sqlite`;
    const destPath = join(this.deps.backupsDir, filename);

    copyFileSync(this.deps.dbFilePath, destPath);
    const sizeBytes = statSync(destPath).size;

    return this.repo().createBackup({
      filename,
      type,
      sizeBytes,
      schemaVersion: 1,
      note: note ?? null,
    });
  }

  async restoreBackup(id: string, confirm: boolean): Promise<boolean> {
    if (!confirm) return false;
    const backup = await this.repo().findById(id);
    if (!backup) return false;
    const backupPath = join(this.deps.backupsDir, backup.filename);
    if (!existsSync(backupPath)) return false;
    if (this.deps.dbFilePath === ':memory:') {
      throw new Error('内存数据库不支持恢复');
    }

    // 校验备份文件是有效 SQLite 数据库且 schema 版本一致。
    const checkClient = createClient({ url: `file:${backupPath}` });
    try {
      await checkClient.execute('SELECT 1');
      const versionResult = await checkClient.execute(
        'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
      );
      const version = versionResult.rows[0]?.version;
      if (typeof version !== 'number' || version < 1) {
        throw new Error('备份文件 schema 版本无效');
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('schema 版本无效')) {
        throw err;
      }
      throw new Error('备份文件不是有效的 SQLite 数据库');
    } finally {
      await checkClient.close();
    }

    // 关闭当前数据库连接后替换文件，避免 Windows 下文件占用导致复制失败。
    if (this.deps.client) {
      await this.deps.client.close();
    }

    restoreSnapshot(backupPath, this.deps.dbFilePath, this.deps.backupsDir);
    return true;
  }

  async deleteBackup(id: string): Promise<boolean> {
    const backup = await this.repo().findById(id);
    if (!backup) return false;
    const backupPath = join(this.deps.backupsDir, backup.filename);
    if (existsSync(backupPath)) {
      unlinkSync(backupPath);
    }
    await this.repo().deleteBackup(id);
    return true;
  }

  async exportNonSensitiveConfig(): Promise<Record<string, unknown>> {
    const upstreamRepo = new UpstreamKeyRepository(this.deps.db);
    const publicModelRepo = new PublicModelRepository(this.deps.db);
    const modelGroupRepo = new ModelGroupRepository(this.deps.db);
    const appRepo = new AppRepository(this.deps.db);

    const [upstreams, publicModels, modelGroups, apps] = await Promise.all([
      upstreamRepo.listUpstreamKeys(),
      publicModelRepo.listPublicModels(),
      modelGroupRepo.listModelGroups(),
      appRepo.listApps(),
    ]);

    return {
      upstreams: upstreams.map((u) => ({
        id: u.id,
        name: u.name,
        providerType: u.providerType,
        baseUrl: u.baseUrl,
        supportedModelsJson: u.supportedModelsJson,
        displayOrder: u.displayOrder,
        enabled: u.enabled,
      })),
      publicModels,
      modelGroups,
      apps,
    };
  }
}
