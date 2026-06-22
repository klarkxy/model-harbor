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

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const ARTIFICIAL_ANALYSIS_URL = 'https://artificialanalysis.ai/leaderboards/models';
const AIDER_LEADERBOARD_URL = 'https://aider.chat/docs/leaderboards/';
const ARENA_LEADERBOARD_URL = 'https://arena.ai/leaderboard';
const OPENCOMPASS_LEADERBOARD_URL = 'https://rank.opencompass.org.cn/leaderboard-llm-v2';
const SUPERCLUE_URL = 'https://www.superclueai.com/';

const DOMESTIC_OPENROUTER_PROVIDERS = [
  'deepseek',
  'qwen',
  'alibaba',
  'moonshot',
  'kimi',
  'z-ai',
  'zhipu',
  'glm',
  'minimax',
  'baichuan',
  'yi',
] as const;

const PRESET_WEIGHTS: Record<AutoGroupPreset, Required<AutoGroupWeights>> = {
  balanced: {
    intelligence: 0.22,
    chat: 0.12,
    knowledge: 0.1,
    math: 0.08,
    chinese: 0.08,
    reasoning: 0.12,
    coding: 0.14,
    agentic: 0.08,
    costEfficiency: 0.04,
    price: 0.02,
    context: 0.02,
  },
  chat: {
    intelligence: 0.26,
    chat: 0.34,
    knowledge: 0.08,
    math: 0.02,
    chinese: 0.12,
    reasoning: 0.08,
    coding: 0.04,
    agentic: 0.02,
    costEfficiency: 0.02,
    price: 0.02,
    context: 0.02,
  },
  code: {
    intelligence: 0.08,
    chat: 0.02,
    knowledge: 0.04,
    math: 0.06,
    chinese: 0.02,
    reasoning: 0.12,
    coding: 0.56,
    agentic: 0.12,
    costEfficiency: 0.04,
    price: 0.02,
    context: 0.01,
  },
  plan: {
    intelligence: 0.18,
    chat: 0.08,
    knowledge: 0.12,
    math: 0.08,
    chinese: 0.04,
    reasoning: 0.24,
    coding: 0.08,
    agentic: 0.14,
    costEfficiency: 0.02,
    price: 0.02,
    context: 0.02,
  },
  cheap: {
    intelligence: 0.08,
    chat: 0.04,
    knowledge: 0.04,
    math: 0.02,
    chinese: 0.04,
    reasoning: 0.04,
    coding: 0.04,
    agentic: 0.02,
    costEfficiency: 0.48,
    price: 0.18,
    context: 0.02,
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
    const primary =
      group.find((row) => row.source === 'openrouter') ??
      group.find((row) => row.source === 'artificial_analysis') ??
      group[0]!;
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

function sourcesForRegion(region: ModelReferenceRegion): ModelReferenceSource[] {
  return region === 'domestic'
    ? ['openrouter', 'aider', 'opencompass', 'superclue']
    : ['openrouter', 'artificial_analysis', 'arena', 'aider'];
}

function normalizeScoreKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_(index|score|rank|percentile)$/g, '')
    .replace(/^_|_$/g, '');
}

function collectOpenRouterScores(artificial: Record<string, unknown>): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const [key, value] of Object.entries(artificial)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const normalized = normalizeScoreKey(key);
    if (!normalized) continue;
    scores[normalized] = value;
  }
  const aliasPairs: Array<[string, string[]]> = [
    ['intelligence', ['intelligence', 'intelligence_index']],
    ['coding', ['coding', 'coding_index', 'code']],
    ['agentic', ['agentic', 'agentic_index', 'agent']],
    ['reasoning', ['reasoning', 'reasoning_index', 'analysis']],
    ['chat', ['chat', 'arena', 'preference', 'conversation']],
    ['knowledge', ['knowledge', 'mmlu', 'humanities', 'science']],
    ['math', ['math', 'math_index', 'mathematics']],
    ['chinese', ['chinese', 'ceval', 'cmmlu', 'clue']],
  ];
  for (const [target, candidates] of aliasPairs) {
    if (typeof scores[target] === 'number') continue;
    const found = candidates.map(normalizeScoreKey).find((candidate) => typeof scores[candidate] === 'number');
    if (found) scores[target] = scores[found]!;
  }
  if (typeof scores.reasoning !== 'number' && typeof scores.intelligence === 'number') {
    scores.reasoning = scores.intelligence;
  }
  if (typeof scores.knowledge !== 'number' && typeof scores.intelligence === 'number') {
    scores.knowledge = scores.intelligence;
  }
  return scores;
}

function isDomesticOpenRouterModel(id: string, name: string): boolean {
  const haystack = `${id} ${name}`.toLowerCase();
  return DOMESTIC_OPENROUTER_PROVIDERS.some((provider) => haystack.includes(provider));
}

function isDomesticReferenceModel(id: string, name: string): boolean {
  return isDomesticOpenRouterModel(id, name);
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

function mapOpenRouterModel(
  raw: unknown,
  now: Date,
  region: ModelReferenceRegion,
): ModelReferenceEntryInsert | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id : null;
  const name = typeof item.name === 'string' ? item.name : id;
  if (!id || !name) return null;
  if (region === 'domestic' && !isDomesticOpenRouterModel(id, name)) return null;
  const normalized = normalizeModelName(id);
  if (!normalized) return null;
  const benchmarks =
    item.benchmarks && typeof item.benchmarks === 'object'
      ? (item.benchmarks as Record<string, unknown>)
      : {};
  const artificial =
    benchmarks.artificial_analysis && typeof benchmarks.artificial_analysis === 'object'
      ? (benchmarks.artificial_analysis as Record<string, unknown>)
      : {};
  const scores = collectOpenRouterScores(artificial);
  const pricing =
    item.pricing && typeof item.pricing === 'object' ? (item.pricing as Record<string, unknown>) : {};
  const prompt = Number(pricing.prompt);
  const completion = Number(pricing.completion);
  const price: Record<string, number | string | boolean> = {};
  if (Number.isFinite(prompt) && prompt >= 0) price.inputUsdPerMTok = prompt * 1_000_000;
  if (Number.isFinite(completion) && completion >= 0) price.outputUsdPerMTok = completion * 1_000_000;
  if (typeof price.inputUsdPerMTok === 'number' && typeof price.outputUsdPerMTok === 'number') {
    price.blendedUsdPerMTok = (price.inputUsdPerMTok + price.outputUsdPerMTok) / 2;
  }
  price.source = 'openrouter';
  const contextLength = typeof item.context_length === 'number' ? item.context_length : null;
  return {
    id: entryId(),
    region,
    source: 'openrouter',
    normalizedModelName: normalized,
    sourceModelId: id,
    displayName: name,
    provider: typeof name === 'string' && name.includes(':') ? name.split(':')[0]!.trim() : null,
    scoresJson: JSON.stringify(scores),
    priceJson: JSON.stringify(price),
    contextWindow: contextLength,
    outputSpeed: null,
    latencyMs: null,
    sourceUrl: `https://openrouter.ai/models/${id}`,
    rawUnit: 'USD per 1M tokens',
    rawPayloadJson: JSON.stringify(item).slice(0, 20000),
    fetchedAt: now,
    updatedAt: now,
  };
}

async function fetchOpenRouterEntries(
  now: Date,
  region: ModelReferenceRegion,
): Promise<ModelReferenceEntryInsert[]> {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: { accept: 'application/json', 'user-agent': 'ModelHarbor/0.1 model-reference-refresh' },
  });
  if (!res.ok) throw new Error(`OpenRouter refresh failed: HTTP ${res.status}`);
  const payload = (await res.json()) as unknown;
  const data =
    payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : [];
  return data
    .map((item) => mapOpenRouterModel(item, now, region))
    .filter((item): item is ModelReferenceEntryInsert => !!item);
}

function mapAiderBlock(
  block: string[],
  now: Date,
  region: ModelReferenceRegion,
): ModelReferenceEntryInsert | null {
  const modelLine = block.find((line) => line.startsWith('Model : '));
  const commandLine = block.find((line) => line.startsWith('Command : '));
  const passRate2Line = block.find((line) => line.startsWith('Pass rate 2 : '));
  if (!modelLine || !passRate2Line) return null;
  const displayName = modelLine.replace(/^Model : /, '').trim();
  const commandModel = commandLine?.match(/--model\s+([^\s`]+)/)?.[1];
  const sourceModelId = commandModel ?? displayName;
  if (region === 'domestic' && !isDomesticReferenceModel(sourceModelId, displayName)) return null;
  const normalized = normalizeModelName(sourceModelId);
  if (!normalized) return null;
  const passRate1 = parseNumber(block.find((line) => line.startsWith('Pass rate 1 : '))?.replace(/^Pass rate 1 : /, ''));
  const passRate2 = parseNumber(passRate2Line.replace(/^Pass rate 2 : /, ''));
  const wellFormed = parseNumber(
    block.find((line) => line.startsWith('Percent cases well formed : '))?.replace(/^Percent cases well formed : /, ''),
  );
  const totalCost = parseNumber(block.find((line) => line.startsWith('Total cost : '))?.replace(/^Total cost : /, ''));
  const secondsPerCase = parseNumber(
    block.find((line) => line.startsWith('Seconds per case : '))?.replace(/^Seconds per case : /, ''),
  );
  const date = block.find((line) => line.startsWith('Date : '))?.replace(/^Date : /, '').trim();
  const scores: Record<string, number> = {};
  if (passRate2 !== null) scores.coding = passRate2;
  if (passRate1 !== null) scores.aider_pass_rate_1 = passRate1;
  if (passRate2 !== null) scores.aider_pass_rate_2 = passRate2;
  if (wellFormed !== null) scores.aider_well_formed = wellFormed;
  const price: Record<string, number | string | boolean> = { source: 'aider' };
  if (totalCost !== null) price.aiderTotalUsd = totalCost;
  return {
    id: entryId(),
    region,
    source: 'aider',
    normalizedModelName: normalized,
    sourceModelId,
    displayName,
    provider: sourceModelId.includes('/') ? sourceModelId.split('/')[0]!.trim() : null,
    scoresJson: JSON.stringify(scores),
    priceJson: JSON.stringify(price),
    contextWindow: null,
    outputSpeed: null,
    latencyMs: secondsPerCase !== null ? Math.round(secondsPerCase * 1000) : null,
    sourceUrl: AIDER_LEADERBOARD_URL,
    rawUnit: 'Aider polyglot pass rate',
    rawPayloadJson: JSON.stringify({ lines: block, date }).slice(0, 20000),
    fetchedAt: now,
    updatedAt: now,
  };
}

async function fetchAiderEntries(now: Date, region: ModelReferenceRegion): Promise<ModelReferenceEntryInsert[]> {
  const res = await fetch(AIDER_LEADERBOARD_URL, {
    headers: { accept: 'text/html', 'user-agent': 'ModelHarbor/0.1 model-reference-refresh' },
  });
  if (!res.ok) throw new Error(`Aider refresh failed: HTTP ${res.status}`);
  const lines = stripHtmlToLines(await res.text());
  const entries: ModelReferenceEntryInsert[] = [];
  let block: string[] = [];
  for (const line of lines) {
    if (line.startsWith('Model : ') && block.length > 0) {
      const entry = mapAiderBlock(block, now, region);
      if (entry) entries.push(entry);
      block = [];
    }
    if (
      line.startsWith('Model : ') ||
      line.startsWith('Command : ') ||
      line.startsWith('Pass rate ') ||
      line.startsWith('Percent cases well formed : ') ||
      line.startsWith('Seconds per case : ') ||
      line.startsWith('Total cost : ') ||
      line.startsWith('Date : ')
    ) {
      block.push(line);
    }
  }
  const finalEntry = mapAiderBlock(block, now, region);
  if (finalEntry) entries.push(finalEntry);
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.normalizedModelName;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapArtificialAnalysisBlock(
  lines: string[],
  index: number,
  now: Date,
  region: ModelReferenceRegion,
): ModelReferenceEntryInsert | null {
  const displayName = lines[index];
  if (!displayName || displayName.length < 2) return null;
  const context = lines[index + 1] ?? '';
  const provider = lines[index + 2] ?? null;
  const intelligence = parseNumber(lines[index + 3]);
  const blendedPrice = parseNumber(lines[index + 4]);
  if (intelligence === null || !provider || /^\$|--|\d/.test(displayName)) return null;
  if (region === 'domestic' && !isDomesticReferenceModel(displayName, `${provider} ${displayName}`)) return null;
  const contextMatch = context.match(/^(\d+(?:\.\d+)?)([kKmM])$/);
  const contextWindow = contextMatch
    ? Math.round(Number(contextMatch[1]) * (contextMatch[2]!.toLowerCase() === 'm' ? 1_000_000 : 1_000))
    : null;
  const normalized = normalizeModelName(displayName);
  if (!normalized) return null;
  const price: Record<string, number | string | boolean> = { source: 'artificial_analysis' };
  if (blendedPrice !== null) price.blendedUsdPerMTok = blendedPrice;
  return {
    id: entryId(),
    region,
    source: 'artificial_analysis',
    normalizedModelName: normalized,
    sourceModelId: displayName,
    displayName,
    provider,
    scoresJson: JSON.stringify({ intelligence }),
    priceJson: JSON.stringify(price),
    contextWindow,
    outputSpeed: parseNumber(lines[index + 5]) ?? null,
    latencyMs: null,
    sourceUrl: ARTIFICIAL_ANALYSIS_URL,
    rawUnit: 'Artificial Analysis Intelligence Index',
    rawPayloadJson: JSON.stringify({ lines: lines.slice(index, index + 8) }).slice(0, 20000),
    fetchedAt: now,
    updatedAt: now,
  };
}

async function fetchArtificialAnalysisEntries(
  now: Date,
  region: ModelReferenceRegion,
): Promise<ModelReferenceEntryInsert[]> {
  const res = await fetch(ARTIFICIAL_ANALYSIS_URL, {
    headers: { accept: 'text/html', 'user-agent': 'ModelHarbor/0.1 model-reference-refresh' },
  });
  if (!res.ok) throw new Error(`Artificial Analysis refresh failed: HTTP ${res.status}`);
  const lines = stripHtmlToLines(await res.text());
  const entries: ModelReferenceEntryInsert[] = [];
  for (let i = 0; i < lines.length - 6; i += 1) {
    const entry = mapArtificialAnalysisBlock(lines, i, now, region);
    if (entry) entries.push(entry);
  }
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.normalizedModelName;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchReachabilityOnly(
  now: Date,
  region: ModelReferenceRegion,
  source: Extract<ModelReferenceSource, 'arena' | 'opencompass' | 'superclue'>,
): Promise<ModelReferenceEntryInsert[]> {
  const url =
    source === 'arena'
      ? ARENA_LEADERBOARD_URL
      : source === 'opencompass'
        ? OPENCOMPASS_LEADERBOARD_URL
        : SUPERCLUE_URL;
  const res = await fetch(url, {
    headers: { accept: 'text/html,application/json', 'user-agent': 'ModelHarbor/0.1 model-reference-refresh' },
  });
  if (!res.ok) throw new Error(`${source} refresh failed: HTTP ${res.status}`);
  await res.text();
  void now;
  void region;
  return [];
}

async function fetchReferenceEntriesForSource(
  source: ModelReferenceSource,
  now: Date,
  region: ModelReferenceRegion,
): Promise<ModelReferenceEntryInsert[]> {
  if (source === 'openrouter') return await fetchOpenRouterEntries(now, region);
  if (source === 'aider') return await fetchAiderEntries(now, region);
  if (source === 'artificial_analysis') return await fetchArtificialAnalysisEntries(now, region);
  if (source === 'arena' || source === 'opencompass' || source === 'superclue') {
    return await fetchReachabilityOnly(now, region, source);
  }
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
  const where = input.source
    ? and(eq(modelReferenceEntries.region, input.region), eq(modelReferenceEntries.source, input.source))
    : eq(modelReferenceEntries.region, input.region);
  const rows = await db.select().from(modelReferenceEntries).where(where).orderBy(desc(modelReferenceEntries.fetchedAt)).all();
  const statuses = await db
    .select()
    .from(modelReferenceSyncStatus)
    .where(eq(modelReferenceSyncStatus.region, input.region))
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
  const refs = await db.select().from(modelReferenceEntries).where(eq(modelReferenceEntries.region, input.region)).all();
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
    const primaryRef =
      aggregate.references.find((ref) => ref.source === 'openrouter') ??
      aggregate.references.find((ref) => ref.source === 'artificial_analysis') ??
      aggregate.references[0]!;
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
    const q = (req.query ?? {}) as { region?: string; source?: string };
    const region = isReferenceRegion(q.region) ? q.region : 'international';
    const source = isReferenceSource(q.source) ? q.source : undefined;
    return await listReferenceEntries(db, { region, source });
  });

  app.post('/api/admin/model-reference/refresh', async (req) => {
    const body = (req.body ?? {}) as { region?: unknown; force?: unknown };
    const region = isReferenceRegion(body.region) ? body.region : 'international';
    const refreshed = await refreshModelReference(db, {
      region,
      force: body.force === true,
    });
    return refreshed;
  });

  app.post('/api/admin/model-groups/auto-preview', async (req) => {
    const body = (req.body ?? {}) as {
      region?: unknown;
      preset?: unknown;
      weights?: unknown;
      topN?: unknown;
    };
    const region = isReferenceRegion(body.region) ? body.region : 'international';
    const preset = isAutoGroupPreset(body.preset) ? body.preset : 'balanced';
    const topN = typeof body.topN === 'number' ? body.topN : 5;
    const recommendations = await previewAutoGroupMembers(db, {
      region,
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
