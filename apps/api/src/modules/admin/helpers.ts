import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import {
  publicModels,
  modelGroups,
  targetNames,
  type TargetNameRow,
  type TargetType,
} from '../db/index.js';
import { decryptSecret, encryptSecret, randomBase64Url } from '../auth/crypto.js';
import { hashSessionId } from '../auth/session.js';
import { ValidationError, TargetNotFoundError } from '@modelharbor/shared';

const TARGET_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;

export function assertTargetName(name: string): void {
  if (!name) throw new ValidationError('name is required');
  if (name.length > 128) throw new ValidationError('name too long');
  if (!TARGET_NAME_REGEX.test(name)) {
    throw new ValidationError('name must match [a-zA-Z0-9._-]+');
  }
}

export function assertProviderType(
  value: string,
): asserts value is 'anthropic_compatible' | 'openai_compatible' {
  if (value !== 'anthropic_compatible' && value !== 'openai_compatible') {
    throw new ValidationError('providerType must be anthropic_compatible or openai_compatible');
  }
}

export function assertSourceProtocol(value: string): asserts value is 'anthropic' | 'openai' {
  if (value !== 'anthropic' && value !== 'openai') {
    throw new ValidationError('protocol must be anthropic or openai');
  }
}

export function assertQuotaPeriod(
  value: string,
): asserts value is 'hour' | 'day' | 'week' | 'month' | 'total' {
  if (!['hour', 'day', 'week', 'month', 'total'].includes(value)) {
    throw new ValidationError('period must be one of hour|day|week|month|total');
  }
}

export function assertPositiveInt(name: string, value: unknown, max = 2 ** 31 - 1): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw new ValidationError(`${name} must be a non-negative integer`);
  }
  return value;
}

export async function findTargetByName(db: Db, name: string): Promise<TargetNameRow | null> {
  return (await db.select().from(targetNames).where(eq(targetNames.name, name)).get()) ?? null;
}

export async function findPublicModelById(db: Db, id: string) {
  return (await db.select().from(publicModels).where(eq(publicModels.id, id)).get()) ?? null;
}

export async function findModelGroupById(db: Db, id: string) {
  return (await db.select().from(modelGroups).where(eq(modelGroups.id, id)).get()) ?? null;
}

export async function assertPublicModelExists(db: Db, id: string): Promise<void> {
  const found = await findPublicModelById(db, id);
  if (!found) throw new TargetNotFoundError(`public model not found: ${id}`);
}

export async function assertModelGroupExists(db: Db, id: string): Promise<void> {
  const found = await findModelGroupById(db, id);
  if (!found) throw new TargetNotFoundError(`model group not found: ${id}`);
}

export async function resolveTarget(
  db: Db,
  targetType: TargetType,
  targetId: string,
): Promise<void> {
  if (targetType === 'public_model') return assertPublicModelExists(db, targetId);
  return assertModelGroupExists(db, targetId);
}

export function encryptUpstreamApiKey(
  raw: string,
  secretKey: string,
): { ciphertext: string; prefix: string } {
  if (!raw) throw new ValidationError('apiKey is required');
  const enc = encryptSecret(raw, secretKey);
  return { ciphertext: enc.ciphertext, prefix: raw.slice(0, 4) };
}

export function decryptUpstreamApiKey(ciphertext: string, secretKey: string): string {
  return decryptSecret(ciphertext, secretKey);
}

export function generateConsumerKeyRaw(): { raw: string; prefix: string; hash: string } {
  const secret = randomBase64Url(32);
  const raw = `mh_${secret}`;
  return { raw, prefix: raw.slice(0, 7), hash: hashSessionId(raw) };
}

export function safeJsonString(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch {
    return fallback;
  }
}

export function parseJsonArray(text: string | null): string[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) return parsed;
  } catch {
    /* ignore */
  }
  return [];
}

export function parseJsonObject(text: string | null): Record<string, string> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

// Drizzle's transaction callback receives a tx handle that satisfies most of Db's
// surface, but the structural type does not match `Db` exactly. Use this alias so
// helpers can accept a `tx` parameter without restating the union.
type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

// Atomically insert a target row (public_model or model_group) plus a target_names row.
// The pre-check inside the transaction is for a clean 400 message; the UNIQUE INDEX
// on target_names.name is the authoritative guard. If the second insert inside the
// transaction fails for any reason, the whole transaction rolls back so the
// target row and the namespace row stay in sync.
export async function insertTargetRow(
  db: Db,
  args: {
    targetType: TargetType;
    name: string;
    targetId: string;
    insertTarget: (tx: DbTx) => Promise<void>;
  },
): Promise<void> {
  await db.transaction(async (tx: DbTx) => {
    const existing = await tx
      .select()
      .from(targetNames)
      .where(eq(targetNames.name, args.name))
      .get();
    if (existing) {
      throw new ValidationError(`name already in use: ${args.name}`);
    }
    await args.insertTarget(tx);
    await tx.insert(targetNames).values({
      id: `tn_${randomBase64Url(8)}`,
      name: args.name,
      targetType: args.targetType,
      targetId: args.targetId,
      createdAt: new Date(),
    });
  });
}

// Atomic delete: drop the target row and the matching target_names row together.
export async function deleteTargetRow(
  db: Db,
  args: { targetType: TargetType; targetId: string; deleteTarget: (tx: DbTx) => Promise<void> },
): Promise<void> {
  await db.transaction(async (tx: DbTx) => {
    await args.deleteTarget(tx);
    await tx
      .delete(targetNames)
      .where(
        and(eq(targetNames.targetType, args.targetType), eq(targetNames.targetId, args.targetId)),
      );
  });
}

// Atomic "replace all" pattern: delete existing + insert new inside one transaction.
// Either the entire replacement is committed or the existing rows are untouched.
export async function replaceRowsInTransaction<T extends { id: string }>(
  db: Db,
  args: {
    validate?: () => void;
    deleteExisting: (tx: DbTx) => Promise<void>;
    insertAll: (tx: DbTx) => Promise<T[]>;
  },
): Promise<T[]> {
  return await db.transaction(async (tx: DbTx) => {
    args.validate?.();
    await args.deleteExisting(tx);
    return await args.insertAll(tx);
  });
}
