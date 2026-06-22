import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { generateId, ValidationError } from '@modelharbor/shared';
import type { Db } from '../db/index.js';
import {
  MODEL_REFERENCE_REGIONS,
  MODEL_REFERENCE_SOURCES,
  type ModelReferenceRegion,
  type ModelReferenceSource,
  type ModelReferenceEntryInsert,
  type ModelReferenceEntryRow,
  modelReferenceEntries,
  modelReferenceSyncStatus,
  modelGroupMembers,
  publicModelCandidates,
  publicModels,
} from '../db/schema.js';

export const DEFAULT_REFERENCE_TTL_MS = 24 * 60 * 60 * 1000;
export const AUTO_GROUP_PRESETS = ['balanced', 'chat', 'code', 'plan', 'cheap'] as const;
export type AutoGroupPreset = (typeof AUTO_GROUP_PRESETS)[number];

export interface AutoGroupWeights {
  intelligence?: number;
  chat?: number;
  knowledge?: number;
  math?: number;
  chinese?: number;
  coding?: number;
  agentic?: number;
  reasoning?: number;
  costEfficiency?: number;
  price?: number;
  context?: number;
}

export interface AutoGroupRecommendation {
  publicModelId: string;
  publicModelName: string;
  displayName: string | null;
  score: number;
  reference: {
    source: ModelReferenceSource;
    displayName: string;
    provider: string | null;
    scores: Record<string, number>;
    price: Record<string, unknown>;
    contextWindow: number | null;
    outputSpeed: number | null;
    latencyMs: number | null;
    sourceUrl: string;
    fetchedAt: Date;
  };
}

const DATALEARNER_LEADERBOARD_URL = 'https://www.datalearner.com/leaderboards';

const PRESET_WEIGHTS: Record<AutoGroupPreset, Required<AutoGroupWeights>> = {
  balanced: {
    intelligence: 0.2,
    chat: 0.14,
    knowledge: 0.14,
    math: 0.12,
    chinese: 0.08,
    reasoning: 0.12,
    coding: 0.12,
    agentic: 0.08,
    costEfficiency: 0,
    price: 0,
    context: 0,
  },
  chat: {
    intelligence: 0.22,
    chat: 0.4,
    knowledge: 0.1,
    math: 0,
    chinese: 0.14,
    reasoning: 0.08,
    coding: 0.04,
    agentic: 0.02,
    costEfficiency: 0,
    price: 0,
    context: 0,
  },
  code: {
    intelligence: 0.08,
    chat: 0.02,
    knowledge: 0.03,
    math: 0.1,
    chinese: 0,
    reasoning: 0.12,
    coding: 0.55,
    agentic: 0.1,
    costEfficiency: 0,
    price: 0,
    context: 0,
  },
  plan: {
    intelligence: 0.14,
    chat: 0.06,
    knowledge: 0.16,
    math: 0.1,
    chinese: 0.02,
    reasoning: 0.24,
    coding: 0.04,
    agentic: 0.24,
    costEfficiency: 0,
    price: 0,
    context: 0,
  },
  cheap: {
    intelligence: 0.18,
    chat: 0.12,
    knowledge: 0.12,
    math: 0.1,
    chinese: 0.08,
    reasoning: 0.12,
    coding: 0.14,
    agentic: 0.14,
    costEfficiency: 0,
    price: 0,
    context: 0,
  },
};

export const AUTO_GROUP_WEIGHT_KEYS = Object.keys(PRESET_WEIGHTS.balanced) as Array<
  keyof Required<AutoGroupWeights>
>;

export function isReferenceRegion(value: unknown): value is ModelReferenceRegion {
  return typeof value === 'string' && (MODEL_REFERENCE_REGIONS as readonly string[]).includes(value);
}

export function isReferenceSource(value: unknown): value is ModelReferenceSource {
  return typeof value === 'string' && (MODEL_REFERENCE_SOURCES as readonly string[]).includes(value);
}

export function isAutoGroupPreset(value: unknown): value is AutoGroupPreset {
  return typeof value === 'string' && (AUTO_GROUP_PRESETS as readonly string[]).includes(value);
}

export function normalizeModelName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[:~]+/, '')
    .replace(/^(openai|anthropic|google|meta|deepseek|qwen|moonshotai|z-ai|minimax)\//, '')
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function numericScores(row: ModelReferenceEntryRow): Record<string, number> {
  const raw = parseJsonRecord(row.scoresJson);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function priceForScore(row: ModelReferenceEntryRow): number | null {
  const price = parseJsonRecord(row.priceJson);
  const blended = price.blendedUsdPerMTok ?? price.blendedCnyPerMTok;
  if (typeof blended === 'number' && Number.isFinite(blended) && blended >= 0) return blended;
  const input = price.inputUsdPerMTok ?? price.inputCnyPerMTok;
  const output = price.outputUsdPerMTok ?? price.outputCnyPerMTok;
  if (typeof input === 'number' && typeof output === 'number') return (input + output) / 2;
  if (typeof input === 'number') return input;
  if (typeof output === 'number') return output;
  return null;
}

function scoreMetric(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function normalizePositive(value: number | null, max: number): number {
  if (value === null || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function normalizePrice(value: number | null, max: number): number {
  if (value === null || max <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - value / max) * 100));
}

function coerceWeights(preset: AutoGroupPreset, weights: unknown): Required<AutoGroupWeights> {
  const base = PRESET_WEIGHTS[preset];
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) return base;
  const raw = weights as Record<string, unknown>;
  const hasExplicitWeight = AUTO_GROUP_WEIGHT_KEYS.some((key) => typeof raw[key] === 'number');
  const next = hasExplicitWeight
    ? {
        intelligence: 0,
        chat: 0,
        knowledge: 0,
        math: 0,
        chinese: 0,
        reasoning: 0,
        coding: 0,
        agentic: 0,
        costEfficiency: 0,
        price: 0,
        context: 0,
      }
    : { ...base };
  for (const key of AUTO_GROUP_WEIGHT_KEYS) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) {
      next[key] = Math.max(0, raw[key]);
    }
  }
  const total = Object.values(next).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return base;
  for (const key of AUTO_GROUP_WEIGHT_KEYS) {
    next[key] = next[key] / total;
  }
  return next;
}

export function normalizeAutoWeights(preset: AutoGroupPreset, weights: unknown): Required<AutoGroupWeights> {
  return coerceWeights(preset, weights);
}

function presentEntry(row: ModelReferenceEntryRow) {
  return {
    id: row.id,
    region: row.region,
    source: row.source,
    normalizedModelName: row.normalizedModelName,
    sourceModelId: row.sourceModelId,
    displayName: row.displayName,
    provider: row.provider,
    scores: parseJsonRecord(row.scoresJson),
    price: parseJsonRecord(row.priceJson),
    contextWindow: row.contextWindow,
    outputSpeed: row.outputSpeed,
    latencyMs: row.latencyMs,
    sourceUrl: row.sourceUrl,
    rawUnit: row.rawUnit,
    fetchedAt: row.fetchedAt,
    updatedAt: row.updatedAt,
  };
}

function presentAggregatedEntries(rows: ModelReferenceEntryRow[]) {
  const grouped = new Map<string, ModelReferenceEntryRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.normalizedModelName) ?? [];
    list.push(row);
    grouped.set(row.normalizedModelName, list);
  }
  return [...grouped.entries()].map(([normalizedModelName, group]) => {
    const primary = group[0]!;
    const scores: Record<string, number> = {};
    let bestPrice: Record<string, unknown> = {};
    let bestPriceValue: number | null = null;
    let contextWindow: number | null = null;
    let outputSpeed: number | null = null;
    let latencyMs: number | null = null;
    for (const row of group) {
      for (const [key, value] of Object.entries(numericScores(row))) {
        scores[key] = Math.max(scores[key] ?? 0, value);
      }
      const rowPrice = priceForScore(row);
      if (rowPrice !== null && (bestPriceValue === null || rowPrice < bestPriceValue)) {
        bestPriceValue = rowPrice;
        bestPrice = parseJsonRecord(row.priceJson);
      }
      if (row.contextWindow !== null && row.contextWindow > (contextWindow ?? 0)) {
        contextWindow = row.contextWindow;
      }
      if (row.outputSpeed !== null && row.outputSpeed > (outputSpeed ?? 0)) {
        outputSpeed = row.outputSpeed;
      }
      if (row.latencyMs !== null && (latencyMs === null || row.latencyMs < latencyMs)) {
        latencyMs = row.latencyMs;
      }
    }
    return {
      id: `agg_${normalizedModelName}`,
      region: primary.region,
      source: group.map((row) => row.source).join(','),
      normalizedModelName,
      sourceModelId: primary.sourceModelId,
      displayName: primary.displayName,
      provider: primary.provider,
      scores,
      price: bestPrice,
      contextWindow,
      outputSpeed,
      latencyMs,
      sourceUrl: primary.sourceUrl,
      rawUnit: primary.rawUnit,
      fetchedAt: new Date(Math.max(...group.map((row) => row.fetchedAt.getTime()))),
      updatedAt: new Date(Math.max(...group.map((row) => row.updatedAt.getTime()))),
    };
  });
}

async function ensureSyncStatus(db: Db, region: ModelReferenceRegion, source: ModelReferenceSource) {
  const existing = await db
    .select()
    .from(modelReferenceSyncStatus)
    .where(and(eq(modelReferenceSyncStatus.region, region), eq(modelReferenceSyncStatus.source, source)))
    .get();
  if (existing) return existing;
  const now = new Date();
  const row = {
    id: generateId('modelReference'),
    region,
    source,
    status: 'idle' as const,
    lastRefreshAt: null,
    nextRefreshAfter: null,
    lastError: null,
    ttlMs: DEFAULT_REFERENCE_TTL_MS,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(modelReferenceSyncStatus).values(row).onConflictDoNothing({
    target: [modelReferenceSyncStatus.region, modelReferenceSyncStatus.source],
  });
  return (
    (await db
      .select()
      .from(modelReferenceSyncStatus)
      .where(and(eq(modelReferenceSyncStatus.region, region), eq(modelReferenceSyncStatus.source, source)))
      .get()) ?? row
  );
}

function sourcesForRegion(_region: ModelReferenceRegion): ModelReferenceSource[] {
  return ['datalearner'];
}

function stripHtmlToLines(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[$,%]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function entryId(): string {
  return `mr_${generateId('modelReference').slice(-18)}`;
}

function isLikelyModelName(line: string): boolean {
  if (line.length < 2 || line.length > 120) return false;
  if (/^(Image:|详情|查看详情|完整排名|来源：|数据更新于|数据来源：|排名|模型|分数|Elo)/i.test(line)) {
    return false;
  }
  if (/^(HLE|ARC-AGI-2|FrontierMath|SWE-bench|τ²-Bench|闭源|免费商用|不可商用|开源情况)/.test(line)) {
    return false;
  }
  if (/^\d+(?:\.\d+)?$/.test(line)) return false;
  return /[A-Za-z0-9\u4e00-\u9fa5]/.test(line);
}

function parseBenchmarkLine(line: string): [string, number | null] | null {
  const match = line.match(/^(HLE|ARC-AGI-2|FrontierMath(?: - Tier 4)?|SWE-bench Verified|τ²-Bench)\s*(—|-|\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return [match[1]!, parseNumber(match[2])];
}

function mapDataLearnerScores(raw: Record<string, number>): Record<string, number> {
  const scores: Record<string, number> = {};
  if (typeof raw.hle === 'number') {
    scores.intelligence = Math.max(scores.intelligence ?? 0, raw.hle);
    scores.knowledge = Math.max(scores.knowledge ?? 0, raw.hle);
  }
  if (typeof raw.arc_agi_2 === 'number') {
    scores.reasoning = Math.max(scores.reasoning ?? 0, raw.arc_agi_2);
  }
  if (typeof raw.frontiermath === 'number') {
    scores.math = Math.max(scores.math ?? 0, raw.frontiermath);
  }
  if (typeof raw.swe_bench === 'number') {
    scores.coding = Math.max(scores.coding ?? 0, raw.swe_bench);
  }
  if (typeof raw.tau2_bench === 'number') {
    scores.agentic = Math.max(scores.agentic ?? 0, raw.tau2_bench);
  }
  if (typeof raw.lmarena === 'number') {
    scores.chat = Math.max(scores.chat ?? 0, Math.max(0, Math.min(100, ((raw.lmarena - 1000) / 600) * 100)));
    scores.lmarena_elo = raw.lmarena;
  }
  if (typeof raw.aa_intelligence === 'number') {
    scores.intelligence = Math.max(scores.intelligence ?? 0, raw.aa_intelligence);
  }
  return scores;
}

function makeDataLearnerEntry(
  input: {
    displayName: string;
    provider: string | null;
    rawScores: Record<string, number>;
    rawPayload: unknown;
  },
  now: Date,
  region: ModelReferenceRegion,
): ModelReferenceEntryInsert | null {
  const normalized = normalizeModelName(input.displayName);
  const scores = mapDataLearnerScores(input.rawScores);
  if (!normalized || Object.keys(scores).length === 0) return null;
  return {
    id: entryId(),
    region,
    source: 'datalearner',
    normalizedModelName: normalized,
    sourceModelId: input.displayName,
    displayName: input.displayName,
    provider: input.provider,
    scoresJson: JSON.stringify(scores),
    priceJson: JSON.stringify({ source: 'datalearner' }),
    contextWindow: null,
    outputSpeed: null,
    latencyMs: null,
    sourceUrl: DATALEARNER_LEADERBOARD_URL,
    rawUnit: 'DataLearner aggregated benchmark scores',
    rawPayloadJson: JSON.stringify(input.rawPayload).slice(0, 20000),
    fetchedAt: now,
    updatedAt: now,
  };
}

function parseDataLearnerPerformanceTable(
  lines: string[],
  now: Date,
  region: ModelReferenceRegion,
): ModelReferenceEntryInsert[] {
  const start = lines.findIndex((line) => line.includes('大模型性能评测结果'));
  if (start < 0) return [];
  const entries: ModelReferenceEntryInsert[] = [];
  for (let i = start; i < lines.length; i += 1) {
    if (!/^\d{1,3}$/.test(lines[i] ?? '')) continue;
    const window = lines.slice(i + 1, i + 16);
    const firstMetricIndex = window.findIndex((line) => parseBenchmarkLine(line) !== null);
    if (firstMetricIndex <= 0) continue;
    const nameCandidates = window.slice(0, firstMetricIndex).filter(isLikelyModelName);
    const displayName = nameCandidates[0];
    const provider = nameCandidates[1] ?? null;
    if (!displayName) continue;
    const rawScores: Record<string, number> = {};
    for (const line of window.slice(firstMetricIndex)) {
      if (/^\d{1,3}$/.test(line) && Object.keys(rawScores).length > 0) break;
      const parsed = parseBenchmarkLine(line);
      if (!parsed) continue;
      const [label, value] = parsed;
      if (value === null) continue;
      if (label === 'HLE') rawScores.hle = value;
      if (label === 'ARC-AGI-2') rawScores.arc_agi_2 = value;
      if (label.startsWith('FrontierMath')) rawScores.frontiermath = value;
      if (label === 'SWE-bench Verified') rawScores.swe_bench = value;
      if (label === 'τ²-Bench') rawScores.tau2_bench = value;
    }
    const entry = makeDataLearnerEntry(
      { displayName, provider, rawScores, rawPayload: { rank: lines[i], window } },
      now,
      region,
    );
    if (entry) entries.push(entry);
  }
  return entries;
}

function parseDataLearnerSimpleRanking(
  lines: string[],
  marker: string,
  scoreKey: 'aa_intelligence' | 'lmarena',
  now: Date,
  region: ModelReferenceRegion,
): ModelReferenceEntryInsert[] {
  const start = lines.findIndex((line) => line.includes(marker));
  if (start < 0) return [];
  const entries: ModelReferenceEntryInsert[] = [];
  for (let i = start; i < Math.min(lines.length, start + 180); i += 1) {
    if (!/^\d{1,3}$/.test(lines[i] ?? '')) continue;
    const window = lines.slice(i + 1, i + 8);
    const numericIndex = window.findIndex((line) => /^\d+(?:\.\d+)?$/.test(line));
    if (numericIndex <= 0) continue;
    const nameCandidates = window.slice(0, numericIndex).filter(isLikelyModelName);
    const displayName = nameCandidates[0];
    const provider = nameCandidates[1] ?? null;
    const value = parseNumber(window[numericIndex]);
    if (!displayName || value === null) continue;
    const entry = makeDataLearnerEntry(
      {
        displayName,
        provider,
        rawScores: { [scoreKey]: value },
        rawPayload: { rank: lines[i], window, marker },
      },
      now,
      region,
    );
    if (entry) entries.push(entry);
  }
  return entries;
}

async function fetchDataLearnerEntries(now: Date, region: ModelReferenceRegion): Promise<ModelReferenceEntryInsert[]> {
  const res = await fetch(DATALEARNER_LEADERBOARD_URL, {
    headers: { accept: 'text/html', 'user-agent': 'ModelHarbor/0.1 model-reference-refresh' },
  });
  if (!res.ok) throw new Error(`DataLearner refresh failed: HTTP ${res.status}`);
  const lines = stripHtmlToLines(await res.text());
  const entries = [
    ...parseDataLearnerSimpleRanking(lines, 'AA Intelligence Index', 'aa_intelligence', now, region),
    ...parseDataLearnerSimpleRanking(lines, 'LMArena Text Generation', 'lmarena', now, region),
    ...parseDataLearnerPerformanceTable(lines, now, region),
  ];
  const byModel = new Map<string, ModelReferenceEntryInsert>();
  for (const entry of entries) {
    const existing = byModel.get(entry.normalizedModelName);
    if (!existing) {
      byModel.set(entry.normalizedModelName, entry);
      continue;
    }
    const mergedScores = {
      ...parseJsonRecord(existing.scoresJson ?? '{}'),
      ...parseJsonRecord(entry.scoresJson ?? '{}'),
    };
    byModel.set(entry.normalizedModelName, {
      ...existing,
      scoresJson: JSON.stringify(mergedScores),
      rawPayloadJson: JSON.stringify([
        parseJsonRecord(existing.rawPayloadJson ?? '{}'),
        parseJsonRecord(entry.rawPayloadJson ?? '{}'),
      ]).slice(0, 20000),
    });
  }
  return [...byModel.values()];
}

async function fetchReferenceEntriesForSource(
  source: ModelReferenceSource,
  now: Date,
  region: ModelReferenceRegion,
): Promise<ModelReferenceEntryInsert[]> {
  if (source === 'datalearner') return await fetchDataLearnerEntries(now, region);
  return [];
}

async function replaceReferenceEntries(
  db: Db,
  region: ModelReferenceRegion,
  source: ModelReferenceSource,
  entries: ModelReferenceEntryInsert[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(modelReferenceEntries)
      .where(and(eq(modelReferenceEntries.region, region), eq(modelReferenceEntries.source, source)));
    if (entries.length > 0) {
      await tx.insert(modelReferenceEntries).values(entries);
    }
  });
}

export async function refreshModelReference(
  db: Db,
  input: { region: ModelReferenceRegion; force?: boolean },
) {
  const sources = sourcesForRegion(input.region);
  const now = new Date();
  const statuses = await Promise.all(sources.map((source) => ensureSyncStatus(db, input.region, source)));
  const dueStatuses = statuses.filter((status) => input.force || !status.nextRefreshAfter || status.nextRefreshAfter <= now);
  if (dueStatuses.length === 0) {
    const items = await listReferenceEntries(db, { region: input.region });
    return { refreshed: false, sources, items };
  }

  let successCount = 0;
  const errors: string[] = [];
  for (const current of dueStatuses) {
    const source = current.source;
    await db
      .update(modelReferenceSyncStatus)
      .set({ status: 'refreshing', updatedAt: now, lastError: null })
      .where(and(eq(modelReferenceSyncStatus.region, input.region), eq(modelReferenceSyncStatus.source, source)));
    try {
      const entries = await fetchReferenceEntriesForSource(source, now, input.region);
      await replaceReferenceEntries(db, input.region, source, entries);
      await db
        .update(modelReferenceSyncStatus)
        .set({
          status: 'success',
          lastRefreshAt: now,
          nextRefreshAfter: new Date(now.getTime() + current.ttlMs),
          lastError: entries.length === 0 ? 'No structured rows parsed yet' : null,
          updatedAt: now,
        })
        .where(and(eq(modelReferenceSyncStatus.region, input.region), eq(modelReferenceSyncStatus.source, source)));
      successCount += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${source}: ${message}`);
      await db
        .update(modelReferenceSyncStatus)
        .set({
          status: 'error',
          lastError: message,
          updatedAt: new Date(),
        })
        .where(and(eq(modelReferenceSyncStatus.region, input.region), eq(modelReferenceSyncStatus.source, source)));
    }
  }
  const items = await listReferenceEntries(db, { region: input.region });
  if (successCount === 0 && errors.length > 0) {
    throw new Error(errors.join('; '));
  }
  return { refreshed: successCount > 0, sources, items, errors };
}

export async function listReferenceEntries(
  db: Db,
  input: { region: ModelReferenceRegion; source?: ModelReferenceSource },
) {
  const sources = input.source ? [input.source] : sourcesForRegion(input.region);
  const where = input.source
    ? and(eq(modelReferenceEntries.region, input.region), eq(modelReferenceEntries.source, input.source))
    : and(eq(modelReferenceEntries.region, input.region), inArray(modelReferenceEntries.source, sources));
  const rows = await db.select().from(modelReferenceEntries).where(where).orderBy(desc(modelReferenceEntries.fetchedAt)).all();
  const statuses = await db
    .select()
    .from(modelReferenceSyncStatus)
    .where(and(eq(modelReferenceSyncStatus.region, input.region), inArray(modelReferenceSyncStatus.source, sources)))
    .all();
  return {
    items: input.source ? rows.map(presentEntry) : presentAggregatedEntries(rows),
    sync: statuses.map((s) => ({
      region: s.region,
      source: s.source,
      status: s.status,
      lastRefreshAt: s.lastRefreshAt,
      nextRefreshAfter: s.nextRefreshAfter,
      lastError: s.lastError,
      ttlMs: s.ttlMs,
      updatedAt: s.updatedAt,
    })),
  };
}

async function publicModelMatchMap(db: Db) {
  const pms = await db.select().from(publicModels).where(eq(publicModels.enabled, true)).all();
  const candidates = await db.select().from(publicModelCandidates).all();
  const names = new Map<string, typeof pms[number]>();
  const candidateByPublic = new Map<string, string[]>();
  for (const c of candidates) {
    const list = candidateByPublic.get(c.publicModelId) ?? [];
    list.push(c.realModelName);
    candidateByPublic.set(c.publicModelId, list);
  }
  for (const pm of pms) {
    for (const name of [pm.name, pm.displayName ?? '', ...(candidateByPublic.get(pm.id) ?? [])]) {
      const normalized = normalizeModelName(name);
      if (normalized && !names.has(normalized)) names.set(normalized, pm);
    }
  }
  return names;
}

export async function previewAutoGroupMembers(
  db: Db,
  input: {
    region: ModelReferenceRegion;
    preset: AutoGroupPreset;
    weights?: unknown;
    topN?: number;
  },
): Promise<AutoGroupRecommendation[]> {
  const topN = Math.max(1, Math.min(20, Math.round(input.topN ?? 5)));
  const weights = coerceWeights(input.preset, input.weights);
  const refs = await db
    .select()
    .from(modelReferenceEntries)
    .where(and(eq(modelReferenceEntries.region, input.region), inArray(modelReferenceEntries.source, sourcesForRegion(input.region))))
    .all();
  const publicByName = await publicModelMatchMap(db);
  const priceMax = Math.max(...refs.map(priceForScore).filter((v): v is number => v !== null), 0);
  const contextMax = Math.max(...refs.map((r) => r.contextWindow ?? 0), 0);
  const aggregateByPublic = new Map<
    string,
    {
      publicModel: Awaited<ReturnType<typeof publicModelMatchMap>> extends Map<string, infer T> ? T : never;
      scores: Record<string, number>;
      price: Record<string, unknown>;
      priceValue: number | null;
      contextWindow: number | null;
      references: ModelReferenceEntryRow[];
    }
  >();

  for (const ref of refs) {
    const pm = publicByName.get(ref.normalizedModelName);
    if (!pm) continue;
    const scores = numericScores(ref);
    const existing =
      aggregateByPublic.get(pm.id) ??
      ({
        publicModel: pm,
        scores: {},
        price: {},
        priceValue: null,
        contextWindow: null,
        references: [],
      } as {
        publicModel: typeof pm;
        scores: Record<string, number>;
        price: Record<string, unknown>;
        priceValue: number | null;
        contextWindow: number | null;
        references: ModelReferenceEntryRow[];
      });
    for (const [key, value] of Object.entries(scores)) {
      existing.scores[key] = Math.max(existing.scores[key] ?? 0, value);
    }
    const refPrice = priceForScore(ref);
    if (refPrice !== null && (existing.priceValue === null || refPrice < existing.priceValue)) {
      existing.priceValue = refPrice;
      existing.price = parseJsonRecord(ref.priceJson);
    }
    if (ref.contextWindow !== null && ref.contextWindow > (existing.contextWindow ?? 0)) {
      existing.contextWindow = ref.contextWindow;
    }
    existing.references.push(ref);
    aggregateByPublic.set(pm.id, existing);
  }

  const recommendations: AutoGroupRecommendation[] = [];
  for (const aggregate of aggregateByPublic.values()) {
    const scores = aggregate.scores;
    const priceScore = normalizePrice(aggregate.priceValue, priceMax);
    if (aggregate.priceValue !== null) {
      scores.costEfficiency = Math.max(scores.costEfficiency ?? 0, priceScore);
    }
    const contextScore = normalizePositive(aggregate.contextWindow, contextMax);
    const score =
      scoreMetric(scores.intelligence) * weights.intelligence +
      scoreMetric(scores.chat) * weights.chat +
      scoreMetric(scores.knowledge) * weights.knowledge +
      scoreMetric(scores.math) * weights.math +
      scoreMetric(scores.chinese) * weights.chinese +
      scoreMetric(scores.reasoning) * weights.reasoning +
      scoreMetric(scores.coding) * weights.coding +
      scoreMetric(scores.agentic) * weights.agentic +
      scoreMetric(scores.costEfficiency) * weights.costEfficiency +
      priceScore * weights.price +
      contextScore * weights.context;
    const primaryRef = aggregate.references[0]!;
    const recommendation: AutoGroupRecommendation = {
      publicModelId: aggregate.publicModel.id,
      publicModelName: aggregate.publicModel.name,
      displayName: aggregate.publicModel.displayName,
      score: Math.round(score * 100) / 100,
      reference: {
        source: primaryRef.source,
        displayName: primaryRef.displayName,
        provider: primaryRef.provider,
        scores,
        price: aggregate.price,
        contextWindow: aggregate.contextWindow,
        outputSpeed: primaryRef.outputSpeed,
        latencyMs: primaryRef.latencyMs,
        sourceUrl: primaryRef.sourceUrl,
        fetchedAt: primaryRef.fetchedAt,
      },
    };
    recommendations.push(recommendation);
  }
  return recommendations
    .sort((a, b) => b.score - a.score || a.publicModelName.localeCompare(b.publicModelName))
    .slice(0, topN);
}

export async function applyAutoGroupSnapshot(
  db: Db,
  input: {
    modelGroupId: string;
    region: ModelReferenceRegion;
    preset: AutoGroupPreset;
    weights?: unknown;
    topN?: number;
  },
) {
  const recommendations = await previewAutoGroupMembers(db, input);
  if (recommendations.length === 0) {
    throw new ValidationError('no matching public models for auto group');
  }
  const now = new Date();
  const members = recommendations.map((item, idx) => ({
    id: generateId('modelGroup') + '_m',
    modelGroupId: input.modelGroupId,
    publicModelId: item.publicModelId,
    enabled: true,
    priority: (idx + 1) * 10,
    weight: Math.max(1, Math.round(item.score)),
    createdAt: now,
    updatedAt: now,
  }));
  await db.transaction(async (tx) => {
    await tx.delete(modelGroupMembers).where(eq(modelGroupMembers.modelGroupId, input.modelGroupId));
    await tx.insert(modelGroupMembers).values(members);
  });
  return { recommendations, members };
}

export function parseAutoWeightsJson(value: string | null): Required<AutoGroupWeights> | null {
  if (!value) return null;
  const parsed = parseJsonRecord(value);
  const preset = isAutoGroupPreset(parsed.preset) ? parsed.preset : 'balanced';
  return coerceWeights(preset, parsed);
}

export function registerModelReferenceRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  app.get('/api/admin/model-reference', async (req) => {
    const q = (req.query ?? {}) as { source?: string };
    const region: ModelReferenceRegion = 'global';
    const source = isReferenceSource(q.source) ? q.source : undefined;
    return await listReferenceEntries(db, { region, source });
  });

  app.post('/api/admin/model-reference/refresh', async (req) => {
    const body = (req.body ?? {}) as { force?: unknown };
    const refreshed = await refreshModelReference(db, {
      region: 'global',
      force: body.force === true,
    });
    return refreshed;
  });

  app.post('/api/admin/model-groups/auto-preview', async (req) => {
    const body = (req.body ?? {}) as {
      preset?: unknown;
      weights?: unknown;
      topN?: unknown;
    };
    const preset = isAutoGroupPreset(body.preset) ? body.preset : 'balanced';
    const topN = typeof body.topN === 'number' ? body.topN : 5;
    const recommendations = await previewAutoGroupMembers(db, {
      region: 'global',
      preset,
      weights: body.weights,
      topN,
    });
    const ids = recommendations.map((item) => item.publicModelId);
    const publicRows =
      ids.length > 0
        ? await db.select().from(publicModels).where(inArray(publicModels.id, ids)).all()
        : [];
    return { items: recommendations, publicModels: publicRows };
  });
}
