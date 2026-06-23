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

// ReLE (Really Reliable Live Evaluation for LLM) by jeinlee1991 — the
// upstream repository hosts the leaderboard as a Markdown table, not as a
// machine-readable JSON/CSV. We pull alldata.md from raw.githubusercontent.com
// (the GitHub raw CDN) and parse it ourselves. See:
//   https://github.com/jeinlee1991/chinese-llm-benchmark
const RELE_REPO_OWNER = 'jeinlee1991';
const RELE_REPO_NAME = 'chinese-llm-benchmark';
const RELE_RAW_BASE = `https://raw.githubusercontent.com/${RELE_REPO_OWNER}/${RELE_REPO_NAME}/main`;
const RELE_LEADERBOARD_URL = `${RELE_RAW_BASE}/leaderboard/alldata.md`;
const RELE_RELEASES_API = `https://api.github.com/repos/${RELE_REPO_OWNER}/${RELE_REPO_NAME}/releases/latest`;

// Column order in alldata.md (verified 2026-06-23 against the live file).
// The 6th column is an empty placeholder (`| |`) used for layout and is
// intentionally skipped during parsing. Column names match the Markdown
// header verbatim — we look them up by `headerIndex.get(column)`.
const RELE_COLUMNS = [
  '排名',
  '大模型',
  '机构',
  '输出价格',
  '总分',
  '__empty__',
  '教育',
  '医疗与心理健康',
  '金融',
  '法律与行政公务',
  '推理与数学计算',
  '语言与指令遵从',
  'agent与工具调用',
  'coding',
] as const;

const RELE_SCORE_KEYS = new Set<string>([
  '总分',
  '教育',
  '医疗与心理健康',
  '金融',
  '法律与行政公务',
  '推理与数学计算',
  '语言与指令遵从',
  'agent与工具调用',
  'coding',
]);

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
  // ReLE stores CNY per million output tokens. Older USD/CNY-keyed sources
  // may also appear if other sources are wired in later.
  const blended = price.blendedUsdPerMTok ?? price.blendedCnyPerMTok ?? price.cnyPerMTok;
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
    let rank: number | null = null;
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
      const rowRank = parseRankFromPayload(row.rawPayloadJson);
      if (rowRank !== null && (rank === null || rowRank < rank)) {
        rank = rowRank;
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
      rank,
      fetchedAt: new Date(Math.max(...group.map((row) => row.fetchedAt.getTime()))),
      updatedAt: new Date(Math.max(...group.map((row) => row.updatedAt.getTime()))),
    };
  });
}

function parseRankFromPayload(rawPayloadJson: string | null): number | null {
  if (!rawPayloadJson) return null;
  try {
    const parsed = JSON.parse(rawPayloadJson) as { rank?: unknown };
    return typeof parsed.rank === 'number' && Number.isFinite(parsed.rank) ? parsed.rank : null;
  } catch {
    return null;
  }
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
  return ['rele'];
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[$,%]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function entryId(): string {
  return `mr_${generateId('modelReference').slice(-18)}`;
}

function mergeNumericScores(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const existing = merged[key];
      merged[key] = typeof existing === 'number' && Number.isFinite(existing) ? Math.max(existing, value) : value;
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

// Strip ReLE's trailing "(new)" badge so we can match public models that
// have been on the board for a while.
function stripReleNewBadge(value: string): string {
  return value.replace(/\(new\)\s*$/i, '').trim();
}

// Parse `36.0元` (output price per million tokens, CNY). We keep the
// original string in priceJson as `display` so the UI can show "36.0元"
// without losing precision from float round-tripping.
function parseRelePriceCny(value: string): { cnyPerMTok: number | null; display: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { cnyPerMTok: null, display: null };
  const match = trimmed.match(/^([\d.]+)\s*元/);
  if (!match) return { cnyPerMTok: null, display: trimmed };
  const cny = parseNumber(match[1]);
  return { cnyPerMTok: cny, display: trimmed };
}

function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  if (trimmed.length <= 2) return null;
  const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
  if (cells.length < 2) return null;
  // A separator row like `|---|---|` is not data.
  if (cells.every((c) => c === '' || /^:?-+:?$/.test(c))) return null;
  return cells;
}

function parseReleMarkdownTable(markdown: string): { header: string[]; rows: string[][] } {
  const header: string[] = [];
  const rows: string[][] = [];
  let headerSet = false;
  for (const rawLine of markdown.split(/\r?\n/)) {
    if (!rawLine.includes('|')) continue;
    const cells = splitMarkdownTableRow(rawLine);
    if (!cells) continue;
    if (!headerSet) {
      for (const c of cells) header.push(c);
      headerSet = true;
      continue;
    }
    rows.push(cells);
  }
  return { header, rows };
}

// Best-effort: fetch the latest ReLE release tag so each row and the sync
// status can record which version of the leaderboard it was sourced from.
// Returns null on rate-limit / non-2xx; the leaderboard pull still proceeds
// using the live `main` ref as a fallback.
async function fetchReleLatestTag(): Promise<{ tag: string; url: string } | null> {
  try {
    const res = await fetch(RELE_RELEASES_API, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'ModelHarbor/0.1' },
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    if (typeof payload.tag_name !== 'string' || !payload.tag_name) return null;
    return {
      tag: payload.tag_name,
      url:
        typeof payload.html_url === 'string'
          ? payload.html_url
          : `https://github.com/${RELE_REPO_OWNER}/${RELE_REPO_NAME}/releases/tag/${payload.tag_name}`,
    };
  } catch {
    return null;
  }
}

async function fetchReleEntries(now: Date, region: ModelReferenceRegion): Promise<ModelReferenceEntryInsert[]> {
  const res = await fetch(RELE_LEADERBOARD_URL, {
    headers: { accept: 'text/markdown, text/plain;q=0.9, */*;q=0.5', 'user-agent': 'ModelHarbor/0.1 model-reference-refresh' },
  });
  if (!res.ok) throw new Error(`ReLE refresh failed: HTTP ${res.status}`);
  const markdown = await res.text();
  const { header, rows } = parseReleMarkdownTable(markdown);
  if (header.length === 0) throw new Error('ReLE refresh failed: empty markdown table');

  const headerIndex = new Map<string, number>();
  header.forEach((name, idx) => headerIndex.set(name.trim(), idx));

  const tagInfo = await fetchReleLatestTag();
  const tag = tagInfo?.tag ?? 'main';
  const sourceUrl = tagInfo
    ? `${RELE_RAW_BASE.replace('/main', `/tag/${tag}`)}/leaderboard/alldata.md`
    : RELE_LEADERBOARD_URL;
  const rawUnit = `ReLE leaderboard @ ${tag}`;

  const entries: ModelReferenceEntryInsert[] = [];
  for (const cells of rows) {
    const get = (column: (typeof RELE_COLUMNS)[number]): string => {
      const idx = headerIndex.get(column);
      if (idx === undefined) return '';
      return (cells[idx] ?? '').trim();
    };

    const rankStr = get('排名');
    const modelRaw = get('大模型');
    const provider = get('机构') || null;
    const priceRaw = get('输出价格');
    if (!modelRaw) continue;
    if (!/^\d+$/.test(rankStr)) continue;

    const displayName = stripReleNewBadge(modelRaw);
    const normalized = normalizeModelName(displayName);
    if (!normalized) continue;

    const { cnyPerMTok, display: priceDisplay } = parseRelePriceCny(priceRaw);

    const scores: Record<string, number> = {};
    for (const key of RELE_COLUMNS) {
      if (
        key === '__empty__' ||
        key === '排名' ||
        key === '大模型' ||
        key === '机构' ||
        key === '输出价格'
      )
        continue;
      const value = parseNumber(get(key));
      if (value === null) continue;
      scores[key] = value;
    }
    if (Object.keys(scores).length === 0) continue;

    entries.push({
      id: entryId(),
      region,
      source: 'rele',
      normalizedModelName: normalized,
      sourceModelId: modelRaw,
      displayName,
      provider,
      scoresJson: JSON.stringify(scores),
      priceJson: JSON.stringify({
        cnyPerMTok,
        display: priceDisplay,
        currency: 'CNY',
        source: 'rele',
        tag,
      }),
      contextWindow: null,
      outputSpeed: null,
      latencyMs: null,
      sourceUrl,
      rawUnit,
      rawPayloadJson: JSON.stringify({ rank: Number(rankStr), cells, tag }).slice(0, 20000),
      fetchedAt: now,
      updatedAt: now,
    });
  }
  return entries;
}

async function fetchReferenceEntriesForSource(
  source: ModelReferenceSource,
  now: Date,
  region: ModelReferenceRegion,
): Promise<ModelReferenceEntryInsert[]> {
  if (source === 'rele') return await fetchReleEntries(now, region);
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
