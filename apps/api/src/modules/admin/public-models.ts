import { eq, desc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  generateId,
  ValidationError,
  type ProviderType,
  type SourceProtocol,
} from '@modelharbor/shared';
import type { Db } from '../db/index.js';
import {
  type PublicModelRow,
  publicModels,
  publicModelCandidates,
} from '../db/tables/models.js';
import {
  targetNames,
} from '../db/tables/routing.js';
import {
  upstreamKeys,
} from '../db/tables/upstream.js';
import {
  assertTargetName,
  assertProviderType,
  assertSourceProtocol,
  deleteTargetRow,
  findPublicModelById,
  replaceRowsInTransaction,
} from './helpers.js';
import { auditMetaFromRequest } from './upstream-keys.js';
import { recordAuditEvent } from '../observability/index.js';
import { resetPublicModelCandidateOrder } from './upstream-onboarding.js';

export interface PublicModelRouteDeps {
  db: Db;
}

interface CandidateInput {
  upstreamKeyId?: unknown;
  realModelName?: unknown;
  priority?: unknown;
  weight?: unknown;
  enabled?: unknown;
  endpointProtocol?: unknown;
  endpointProviderType?: unknown;
  endpointBaseUrl?: unknown;
  endpointApiPath?: unknown;
}

interface PresentCandidate {
  id: string;
  upstreamKeyId: string;
  realModelName: string;
  priority: number;
  weight: number;
  enabled: boolean;
  endpointProtocol: string | null;
  endpointProviderType: string | null;
  endpointBaseUrl: string | null;
  endpointApiPath: string | null;
  upstreamKey: {
    id: string;
    name: string;
    providerType: string;
    enabled: boolean;
    frozen: boolean;
  } | null;
}

async function loadCandidates(db: Db, publicModelId: string): Promise<PresentCandidate[]> {
  const rows = await db
    .select({ c: publicModelCandidates, u: upstreamKeys })
    .from(publicModelCandidates)
    .leftJoin(upstreamKeys, eq(publicModelCandidates.upstreamKeyId, upstreamKeys.id))
    .where(eq(publicModelCandidates.publicModelId, publicModelId))
    .all();
  return rows.map((row) => ({
    id: row.c.id,
    upstreamKeyId: row.c.upstreamKeyId,
    realModelName: row.c.realModelName,
    priority: row.c.priority,
    weight: row.c.weight,
    enabled: row.c.enabled,
    endpointProtocol: row.c.endpointProtocol,
    endpointProviderType: row.c.endpointProviderType,
    endpointBaseUrl: row.c.endpointBaseUrl,
    endpointApiPath: row.c.endpointApiPath,
    upstreamKey: row.u
      ? {
          id: row.u.id,
          name: row.u.name,
          providerType: row.u.providerType,
          enabled: row.u.enabled,
          frozen: row.u.frozen,
        }
      : null,
  }));
}

function presentPublicModel(row: PublicModelRow, candidateCount: number) {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    enabled: row.enabled,
    candidateOrderCustomized: row.candidateOrderCustomized,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    candidateCount,
  };
}

function normalizeCandidateEndpointFields(c: CandidateInput) {
  const hasAny =
    c.endpointProtocol !== undefined ||
    c.endpointProviderType !== undefined ||
    c.endpointBaseUrl !== undefined ||
    c.endpointApiPath !== undefined;
  if (!hasAny) return {};
  if (
    typeof c.endpointProtocol !== 'string' ||
    typeof c.endpointProviderType !== 'string' ||
    typeof c.endpointBaseUrl !== 'string'
  ) {
    throw new ValidationError(
      'candidate endpoint override requires endpointProtocol, endpointProviderType, and endpointBaseUrl',
    );
  }
  const endpointProtocol = c.endpointProtocol;
  assertSourceProtocol(endpointProtocol);
  const endpointProviderType = c.endpointProviderType;
  assertProviderType(endpointProviderType);
  const endpointBaseUrl = c.endpointBaseUrl.trim();
  if (!endpointBaseUrl) throw new ValidationError('candidate endpointBaseUrl is required');
  return {
    endpointProtocol,
    endpointProviderType,
    endpointBaseUrl,
    endpointApiPath:
      typeof c.endpointApiPath === 'string' && c.endpointApiPath.trim()
        ? c.endpointApiPath.trim()
        : null,
  };
}

export function registerPublicModelRoutes(app: FastifyInstance, deps: PublicModelRouteDeps): void {
  const { db } = deps;

  app.get('/api/admin/public-models', async () => {
    const rows = await db.select().from(publicModels).orderBy(desc(publicModels.createdAt)).all();
    const candidates = await db.select().from(publicModelCandidates).all();
    const counts = new Map<string, number>();
    for (const c of candidates) {
      counts.set(c.publicModelId, (counts.get(c.publicModelId) ?? 0) + 1);
    }
    return { items: rows.map((r) => presentPublicModel(r, counts.get(r.id) ?? 0)) };
  });

  app.get('/api/admin/public-models/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await findPublicModelById(db, id);
    if (!row) {
      reply.code(404).send({
        error: {
          message: 'public model not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }
    const candidates = await loadCandidates(db, id);
    return { ...presentPublicModel(row, candidates.length), candidates };
  });

  app.post('/api/admin/public-models', async (req) => {
    const body = (req.body ?? {}) as {
      name?: unknown;
      displayName?: unknown;
      description?: unknown;
      candidates?: unknown;
    };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    assertTargetName(name);
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : null;
    const description = typeof body.description === 'string' ? body.description.trim() : null;
    const id = generateId('publicModel');
    const now = new Date();

    // Validate and normalize the full candidates batch up front so a bad row
    // never partially applies. Each entry needs an existing upstream key id.
    const candidateInputs = Array.isArray(body.candidates) ? body.candidates : [];
    const normalizedCandidates: Array<{
      id: string;
      publicModelId: string;
      upstreamKeyId: string;
      realModelName: string;
      priority: number;
      weight: number;
      enabled: boolean;
      endpointProtocol?: SourceProtocol;
      endpointProviderType?: ProviderType;
      endpointBaseUrl?: string;
      endpointApiPath?: string | null;
      createdAt: Date;
      updatedAt: Date;
    }> = [];
    const referencedUpstreamIds = new Set<string>();
    for (const raw of candidateInputs) {
      const c = raw as CandidateInput;
      if (typeof c.upstreamKeyId !== 'string' || typeof c.realModelName !== 'string') {
        throw new ValidationError('candidate requires upstreamKeyId and realModelName');
      }
      referencedUpstreamIds.add(c.upstreamKeyId);
      normalizedCandidates.push({
        id: generateId('publicModel') + '_c',
        publicModelId: id,
        upstreamKeyId: c.upstreamKeyId,
        realModelName: c.realModelName,
        ...normalizeCandidateEndpointFields(c),
        priority: typeof c.priority === 'number' ? c.priority : 100,
        weight: typeof c.weight === 'number' ? c.weight : 1,
        enabled: c.enabled === false ? false : true,
        createdAt: now,
        updatedAt: now,
      });
    }
    // Pre-check upstream keys exist. A failed FK inside the transaction would
    // roll back the target insert, but a 422 with a clear message is friendlier
    // than the raw SQLite constraint error.
    if (referencedUpstreamIds.size > 0) {
      const existing = await db.select({ id: upstreamKeys.id }).from(upstreamKeys).all();
      const known = new Set(existing.map((r) => r.id));
      for (const upstreamId of referencedUpstreamIds) {
        if (!known.has(upstreamId)) {
          throw new ValidationError(`upstream key not found: ${upstreamId}`);
        }
      }
    }

    // Single transaction: target + target_names + candidates. If any insert
    // fails, the whole row is rolled back and the namespace stays consistent.
    await db.transaction(async (tx) => {
      // Re-check name uniqueness inside the transaction so two concurrent
      // creates cannot both win. The UNIQUE INDEX is still the source of truth.
      const existingName = await tx
        .select({ id: targetNames.id })
        .from(targetNames)
        .where(eq(targetNames.name, name))
        .get();
      if (existingName) {
        throw new ValidationError(`name already in use: ${name}`);
      }
      await tx.insert(publicModels).values({
        id,
        name,
        displayName,
        description,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(targetNames).values({
        id: `tn_${generateId('publicModel').slice(-8)}`,
        name,
        targetType: 'public_model',
        targetId: id,
        createdAt: now,
      });
      if (normalizedCandidates.length > 0) {
        await tx.insert(publicModelCandidates).values(normalizedCandidates);
      }
    });

    const row = await findPublicModelById(db, id);
    if (!row) throw new Error('insert failed');
    const candidates = await loadCandidates(db, id);
    await recordAuditEvent(db, {
      ...auditMetaFromRequest(req),
      action: 'public_model.create',
      resourceType: 'public_model',
      resourceId: row.id,
      details: { name: row.name, candidates: candidates.length },
    });
    return { ...presentPublicModel(row, candidates.length), candidates };
  });

  app.patch('/api/admin/public-models/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      displayName?: unknown;
      description?: unknown;
      enabled?: unknown;
    };
    const existing = await findPublicModelById(db, id);
    if (!existing) {
      reply.code(404).send({
        error: {
          message: 'public model not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }
    const update: Partial<typeof publicModels.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.displayName === 'string' || body.displayName === null) {
      update.displayName = typeof body.displayName === 'string' ? body.displayName.trim() : null;
    }
    if (typeof body.description === 'string' || body.description === null) {
      update.description = typeof body.description === 'string' ? body.description.trim() : null;
    }
    if (typeof body.enabled === 'boolean') update.enabled = body.enabled;
    await db.update(publicModels).set(update).where(eq(publicModels.id, id));
    const row = await findPublicModelById(db, id);
    if (!row) throw new Error('not found');
    const candidates = await loadCandidates(db, id);
    await recordAuditEvent(db, {
      ...auditMetaFromRequest(req),
      action: 'public_model.update',
      resourceType: 'public_model',
      resourceId: row.id,
      details: { name: row.name, enabled: row.enabled },
    });
    return { ...presentPublicModel(row, candidates.length), candidates };
  });

  app.put('/api/admin/public-models/:id/candidates', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { candidates?: unknown };
    const existing = await findPublicModelById(db, id);
    if (!existing) {
      reply.code(404).send({
        error: {
          message: 'public model not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }
    if (!Array.isArray(body.candidates)) {
      throw new ValidationError('candidates must be an array');
    }
    const now = new Date();
    // Validate and normalize the full batch up front so a bad row never partially applies.
    const normalized = body.candidates.map((raw) => {
      const c = raw as CandidateInput;
      if (typeof c.upstreamKeyId !== 'string' || typeof c.realModelName !== 'string') {
        throw new ValidationError('candidate requires upstreamKeyId and realModelName');
      }
      return {
        id: generateId('publicModel') + '_c',
        publicModelId: id,
        upstreamKeyId: c.upstreamKeyId,
        realModelName: c.realModelName,
        ...normalizeCandidateEndpointFields(c),
        priority: typeof c.priority === 'number' ? c.priority : 100,
        weight: typeof c.weight === 'number' ? c.weight : 1,
        enabled: c.enabled === false ? false : true,
        createdAt: now,
        updatedAt: now,
      };
    });
    await replaceRowsInTransaction(db, {
      validate: () => undefined,
      deleteExisting: async (tx) => {
        await tx.delete(publicModelCandidates).where(eq(publicModelCandidates.publicModelId, id));
      },
      insertAll: async (tx) => {
        if (normalized.length === 0) return [];
        await tx.insert(publicModelCandidates).values(normalized);
        return normalized;
      },
    });
    await db
      .update(publicModels)
      .set({ candidateOrderCustomized: true, updatedAt: new Date() })
      .where(eq(publicModels.id, id));
    await recordAuditEvent(db, {
      ...auditMetaFromRequest(req),
      action: 'public_model.update',
      resourceType: 'public_model',
      resourceId: id,
      details: { candidatesCount: normalized.length },
    });
    const candidates = await loadCandidates(db, id);
    return { candidates };
  });

  app.post('/api/admin/public-models/:id/candidates/reset-order', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await findPublicModelById(db, id);
    if (!existing) {
      reply.code(404).send({
        error: {
          message: 'public model not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }
    await resetPublicModelCandidateOrder(db, id, false);
    const candidates = await loadCandidates(db, id);
    await recordAuditEvent(db, {
      ...auditMetaFromRequest(req),
      action: 'public_model.update',
      resourceType: 'public_model',
      resourceId: id,
      details: { resetCandidateOrder: true },
    });
    return { candidates };
  });

  app.delete('/api/admin/public-models/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await findPublicModelById(db, id);
    if (!existing) {
      reply.code(404).send({
        error: {
          message: 'public model not found',
          type: 'target_not_found',
          code: 'target_not_found',
        },
      });
      return;
    }
    await deleteTargetRow(db, {
      targetType: 'public_model',
      targetId: id,
      deleteTarget: async (tx) => {
        await tx.delete(publicModels).where(eq(publicModels.id, id));
      },
    });
    await recordAuditEvent(db, {
      ...auditMetaFromRequest(req),
      action: 'public_model.delete',
      resourceType: 'public_model',
      resourceId: id,
    });
    return { id, deleted: true };
  });
}
