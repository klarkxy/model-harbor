import { and, eq } from 'drizzle-orm';
import { generateId } from '@modelharbor/shared';
import {
  type Db,
  modelGroupMembers,
  modelGroups,
  publicModelCandidates,
  publicModels,
  targetNames,
} from '../db/index.js';
import { getModelMappings, type ProviderPreset } from '../providers/presets.js';

export interface OnboardingResult {
  publicModelIds: string[];
  modelGroupId: string;
}

export interface OnboardingMapping {
  publicName: string;
  realName: string;
  enabled: boolean;
}

// Create or reuse public models, candidates, and a model group for a newly
// created upstream key based on its provider preset. Existing public models
// and groups with matching names are reused so the same preset can be applied
// to multiple upstream keys without name collisions.
export async function onboardUpstreamKey(
  db: Db,
  upstreamKeyId: string,
  preset: ProviderPreset,
): Promise<OnboardingResult> {
  const mappings = getModelMappings(preset).map((m) => ({ ...m, enabled: true }));
  return onboardUpstreamKeyWithMappings(db, upstreamKeyId, preset.name, mappings);
}

// Same as onboardUpstreamKey but with caller-supplied mappings. Used when the
// admin customizes the model list in the UI.
export async function onboardUpstreamKeyWithMappings(
  db: Db,
  upstreamKeyId: string,
  groupName: string,
  mappings: OnboardingMapping[],
): Promise<OnboardingResult> {
  const now = new Date();
  const publicModelIds: string[] = [];
  let groupId = '';

  await db.transaction(async (tx) => {
    // 1. Ensure public models and candidates exist for every enabled mapping.
    for (const mapping of mappings) {
      if (!mapping.enabled) continue;

      let pmId: string;
      const existingPm = await tx
        .select({ id: publicModels.id })
        .from(publicModels)
        .where(eq(publicModels.name, mapping.publicName))
        .get();
      if (existingPm) {
        pmId = existingPm.id;
      } else {
        pmId = generateId('publicModel');
        await tx.insert(publicModels).values({
          id: pmId,
          name: mapping.publicName,
          displayName: mapping.publicName,
          description: null,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(targetNames).values({
          id: `tn_${generateId('publicModel').slice(-8)}`,
          name: mapping.publicName,
          targetType: 'public_model',
          targetId: pmId,
          createdAt: now,
        });
      }
      publicModelIds.push(pmId);

      const existingCandidate = await tx
        .select({ id: publicModelCandidates.id })
        .from(publicModelCandidates)
        .where(
          and(
            eq(publicModelCandidates.publicModelId, pmId),
            eq(publicModelCandidates.upstreamKeyId, upstreamKeyId),
            eq(publicModelCandidates.realModelName, mapping.realName),
          ),
        )
        .get();
      if (!existingCandidate) {
        await tx.insert(publicModelCandidates).values({
          id: generateId('publicModel') + '_c',
          publicModelId: pmId,
          upstreamKeyId,
          realModelName: mapping.realName,
          enabled: true,
          priority: 100,
          weight: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (publicModelIds.length === 0) {
      return { publicModelIds, modelGroupId: groupId };
    }

    // 2. Ensure the provider-level model group exists.
    const existingGroup = await tx
      .select({ id: modelGroups.id })
      .from(modelGroups)
      .where(eq(modelGroups.name, groupName))
      .get();
    if (existingGroup) {
      groupId = existingGroup.id;
    } else {
      groupId = generateId('modelGroup');
      await tx.insert(modelGroups).values({
        id: groupId,
        name: groupName,
        displayName: groupName,
        description: null,
        enabled: true,
        routingPolicy: 'priority',
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(targetNames).values({
        id: `tn_${generateId('modelGroup').slice(-8)}`,
        name: groupName,
        targetType: 'model_group',
        targetId: groupId,
        createdAt: now,
      });
    }

    // 3. Add all public models to the group (skip existing members).
    for (const pmId of publicModelIds) {
      const existingMember = await tx
        .select({ id: modelGroupMembers.id })
        .from(modelGroupMembers)
        .where(
          and(
            eq(modelGroupMembers.modelGroupId, groupId),
            eq(modelGroupMembers.publicModelId, pmId),
          ),
        )
        .get();
      if (!existingMember) {
        await tx.insert(modelGroupMembers).values({
          id: generateId('modelGroup') + '_m',
          modelGroupId: groupId,
          publicModelId: pmId,
          enabled: true,
          priority: 100,
          weight: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  });

  return { publicModelIds, modelGroupId: groupId };
}

export interface UpstreamKeyCandidateMapping {
  publicName: string;
  realName: string;
  enabled: boolean;
}

export interface UpstreamKeyCandidate {
  id: string;
  publicModelId: string;
  publicName: string;
  realName: string;
  enabled: boolean;
  priority: number;
  weight: number;
}

// Fully synchronize the public-model candidates for an upstream key with the
// caller-supplied mappings. Creates public models and target names as needed,
// updates existing candidates, and removes candidates no longer present.
export async function getUpstreamKeyCandidates(
  db: Db,
  upstreamKeyId: string,
): Promise<UpstreamKeyCandidate[]> {
  const rows = await db
    .select({ c: publicModelCandidates, p: publicModels })
    .from(publicModelCandidates)
    .innerJoin(publicModels, eq(publicModelCandidates.publicModelId, publicModels.id))
    .where(eq(publicModelCandidates.upstreamKeyId, upstreamKeyId))
    .all();
  return rows.map(({ c, p }) => ({
    id: c.id,
    publicModelId: c.publicModelId,
    publicName: p.name,
    realName: c.realModelName,
    enabled: c.enabled,
    priority: c.priority,
    weight: c.weight,
  }));
}

export async function syncUpstreamKeyMappings(
  db: Db,
  upstreamKeyId: string,
  mappings: UpstreamKeyCandidateMapping[],
): Promise<UpstreamKeyCandidate[]> {
  const now = new Date();
  const activeMappings = mappings.filter((m) => m.enabled && m.realName.trim() !== '');

  return db.transaction(async (tx) => {
    // 1. Ensure public models exist for every active mapping and collect IDs.
    const desired = new Map<string, UpstreamKeyCandidateMapping>();
    for (const mapping of activeMappings) {
      const publicName = mapping.publicName.trim() || mapping.realName.trim();
      const realName = mapping.realName.trim();
      const key = `${publicName}\0${realName}`;
      desired.set(key, { ...mapping, publicName, realName });

      let pmId: string;
      const existingPm = await tx
        .select({ id: publicModels.id })
        .from(publicModels)
        .where(eq(publicModels.name, publicName))
        .get();
      if (existingPm) {
        pmId = existingPm.id;
      } else {
        pmId = generateId('publicModel');
        await tx.insert(publicModels).values({
          id: pmId,
          name: publicName,
          displayName: publicName,
          description: null,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(targetNames).values({
          id: `tn_${generateId('publicModel').slice(-8)}`,
          name: publicName,
          targetType: 'public_model',
          targetId: pmId,
          createdAt: now,
        });
      }
    }

    // 2. Load existing candidates for this upstream key.
    const existing = await tx
      .select({ c: publicModelCandidates, p: publicModels })
      .from(publicModelCandidates)
      .innerJoin(publicModels, eq(publicModelCandidates.publicModelId, publicModels.id))
      .where(eq(publicModelCandidates.upstreamKeyId, upstreamKeyId))
      .all();

    // 3. Upsert: update existing candidates, insert missing ones.
    const result: UpstreamKeyCandidate[] = [];
    const handled = new Set<string>();
    for (const { c, p } of existing) {
      const key = `${p.name}\0${c.realModelName}`;
      const mapping = desired.get(key);
      if (mapping) {
        await tx
          .update(publicModelCandidates)
          .set({ enabled: mapping.enabled, updatedAt: now })
          .where(eq(publicModelCandidates.id, c.id));
        result.push({
          id: c.id,
          publicModelId: c.publicModelId,
          publicName: p.name,
          realName: c.realModelName,
          enabled: mapping.enabled,
          priority: c.priority,
          weight: c.weight,
        });
        handled.add(key);
      }
    }

    for (const [key, mapping] of desired) {
      if (handled.has(key)) continue;
      const pm = await tx
        .select({ id: publicModels.id })
        .from(publicModels)
        .where(eq(publicModels.name, mapping.publicName))
        .get();
      if (!pm) continue; // Should not happen since we created above.
      const id = generateId('publicModel') + '_c';
      await tx.insert(publicModelCandidates).values({
        id,
        publicModelId: pm.id,
        upstreamKeyId,
        realModelName: mapping.realName,
        enabled: mapping.enabled,
        priority: 100,
        weight: 1,
        createdAt: now,
        updatedAt: now,
      });
      result.push({
        id,
        publicModelId: pm.id,
        publicName: mapping.publicName,
        realName: mapping.realName,
        enabled: mapping.enabled,
        priority: 100,
        weight: 1,
      });
      handled.add(key);
    }

    // 4. Delete candidates that are no longer in the active mapping list.
    const desiredKeys = new Set(desired.keys());
    for (const { c, p } of existing) {
      const key = `${p.name}\0${c.realModelName}`;
      if (!desiredKeys.has(key)) {
        await tx.delete(publicModelCandidates).where(eq(publicModelCandidates.id, c.id));
      }
    }

    return result;
  });
}
