import { z } from 'zod';
import { successEnvelope, listEnvelope } from '../envelope.js';

export const backupSchema = z.object({
  id: z.string(),
  type: z.enum(['full', 'config']),
  filename: z.string(),
  sizeBytes: z.number(),
  schemaVersion: z.number(),
  note: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export const createBackupRequestSchema = z.object({
  type: z.enum(['full', 'config']).default('full'),
  note: z.string().optional(),
});

export const restoreBackupRequestSchema = z.object({
  confirm: z.boolean().refine((v) => v === true, { message: '必须显式确认恢复操作' }),
});

export const backupResponseSchema = successEnvelope(backupSchema);
export const listBackupsResponseSchema = listEnvelope(backupSchema);

export type BackupContract = z.infer<typeof backupSchema>;
export type CreateBackupRequest = z.infer<typeof createBackupRequestSchema>;
export type RestoreBackupRequest = z.infer<typeof restoreBackupRequestSchema>;
