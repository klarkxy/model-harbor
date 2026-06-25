import { api } from '../client.js';
import type {
  BackupContract,
  CreateBackupRequest,
  RestoreBackupRequest,
} from '@manageyourllm/contracts';

export async function listBackups(): Promise<BackupContract[]> {
  const res = await api.get<{ data: BackupContract[] }>('/api/admin/backups');
  return res.data;
}

export async function createBackup(body: CreateBackupRequest): Promise<BackupContract> {
  const res = await api.post<{ data: BackupContract }>('/api/admin/backups', body);
  return res.data;
}

export async function restoreBackup(
  id: string,
  body: RestoreBackupRequest,
): Promise<{ ok: boolean }> {
  const res = await api.post<{ data: { ok: boolean } }>(`/api/admin/backups/${id}/restore`, body);
  return res.data;
}

export async function deleteBackup(id: string): Promise<{ ok: boolean }> {
  const res = await api.delete<{ data: { ok: boolean } }>(`/api/admin/backups/${id}`);
  return res.data;
}

export async function exportConfig(): Promise<Record<string, unknown>> {
  const res = await api.get<{ data: Record<string, unknown> }>('/api/admin/backups/export-config');
  return res.data;
}
