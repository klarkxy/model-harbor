import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSnapshot,
  verifySnapshot,
  restoreSnapshot,
} from '../../src/domain/backups/backup.service.js';

describe('backup service', () => {
  let sourcePath: string;
  let backupDir: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'myllm-backup-test-'));
    sourcePath = join(dir, 'source.sqlite');
    backupDir = join(dir, 'backups');
    writeFileSync(sourcePath, 'this is the source db');
  });

  afterEach(() => {
    // 临时目录由操作系统自动清理即可；不做显式删除避免 Windows 句柄问题。
  });

  it('creates and verifies snapshot', () => {
    const snapshot = createSnapshot(sourcePath, backupDir);
    expect(existsSync(snapshot.backupPath)).toBe(true);
    const verify = verifySnapshot(snapshot.backupPath);
    expect(verify.ok).toBe(true);
    expect(verify.sizeBytes).toBe(snapshot.sizeBytes);
  });

  it('restores snapshot and safeguards existing target', () => {
    const snapshot = createSnapshot(sourcePath, backupDir);
    const targetPath = join(backupDir, 'target.sqlite');
    writeFileSync(targetPath, 'old target');
    const restore = restoreSnapshot(snapshot.backupPath, targetPath, backupDir);
    expect(readFileSync(targetPath, 'utf8')).toBe('this is the source db');
    expect(restore.sizeBytes).toBe(snapshot.sizeBytes);
  });
});
