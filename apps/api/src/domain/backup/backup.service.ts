import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { BackupRepository } from '../../infrastructure/db/repositories/backup.repository.js';
import { UpstreamKeyRepository } from '../../infrastructure/db/repositories/upstream-key.repository.js';
import { PublicModelRepository } from '../../infrastructure/db/repositories/public-model.repository.js';
import { ModelGroupRepository } from '../../infrastructure/db/repositories/model-group.repository.js';
import { AppRepository } from '../../infrastructure/db/repositories/app.repository.js';
import type { Db } from '../../infrastructure/db/client.js';
import type { BackupType } from '../../infrastructure/db/schema.js';

export interface BackupServiceDeps {
  db: Db;
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
    // 真实恢复需要先关闭数据库连接再替换文件；这里作为占位实现，仅验证确认标志。
    // Phase 后续补充完整恢复流程。
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
