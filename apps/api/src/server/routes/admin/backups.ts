import type { FastifyInstance } from 'fastify';
import {
  listBackupsResponseSchema,
  backupResponseSchema,
  createBackupRequestSchema,
  restoreBackupRequestSchema,
  successEnvelope,
} from '@manageyourllm/contracts';
import { BackupService } from '../../../application/backup.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';
import { z } from 'zod';

export interface BackupRouteDeps {
  db: Db;
  client?: { close(): void | Promise<void> };
  dbFilePath: string;
  backupsDir: string;
}

export async function backupRoutes(app: FastifyInstance, deps: BackupRouteDeps): Promise<void> {
  const service = new BackupService(deps);

  app.get('/', async () => {
    const backups = await service.listBackups();
    return listBackupsResponseSchema.parse({ data: serializeForContract(backups) });
  });

  app.post('/', async (req) => {
    const body = createBackupRequestSchema.parse(req.body);
    const backup = await service.createBackup(body.type, body.note);
    return backupResponseSchema.parse({ data: serializeForContract(backup) });
  });

  app.post('/:id/restore', async (req) => {
    const { id } = req.params as { id: string };
    const body = restoreBackupRequestSchema.parse(req.body);
    const ok = await service.restoreBackup(id, body.confirm);
    return successEnvelope(
      z.object({ ok: z.boolean(), requiresRestart: z.boolean().optional() }),
    ).parse({
      data: { ok, requiresRestart: ok ? true : undefined },
    });
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const ok = await service.deleteBackup(id);
    return successEnvelope(z.object({ ok: z.boolean() })).parse({ data: { ok } });
  });

  app.get('/export-config', async () => {
    const config = await service.exportNonSensitiveConfig();
    return successEnvelope(z.record(z.unknown())).parse({ data: config });
  });
}
