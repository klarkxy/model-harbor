import type {
  ModelReferenceEntryInsert,
  ModelReferenceRegion,
  ModelReferenceSource,
} from '../db/schema.js';

export type ModelReferenceEntryInput = Omit<
  ModelReferenceEntryInsert,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface ModelReferenceSourceClient {
  fetch(
    region: ModelReferenceRegion,
    abortSignal?: AbortSignal,
  ): Promise<ModelReferenceEntryInput[]>;
}

interface ArenaLeaderboardModel {
  rank: number;
  model: string;
  vendor: string;
  license: string;
  score: number;
  ci: number;
  votes: number;
}

interface ArenaLeaderboardResponse {
  meta: {
    leaderboard: string;
    source_url: string;
    fetched_at: string;
    last_updated: string;
    model_count: number;
  };
  models: ArenaLeaderboardModel[];
}

export class ArenaModelReferenceClient implements ModelReferenceSourceClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: { baseUrl?: string; timeoutMs?: number }) {
    this.baseUrl = options?.baseUrl ?? 'https://api.wulong.dev/arena-ai-leaderboards/v1';
    this.timeoutMs = options?.timeoutMs ?? 15_000;
  }

  async fetch(
    region: ModelReferenceRegion,
    abortSignal?: AbortSignal,
  ): Promise<ModelReferenceEntryInput[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const response = await fetch(`${this.baseUrl}/leaderboard?name=text`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`Arena API returned ${response.status}`);
      }

      const body = (await response.json()) as ArenaLeaderboardResponse;
      const source: ModelReferenceSource = 'arena';
      const fetchedAt = new Date(body.meta.fetched_at);
      const sourceUrl = body.meta.source_url;

      return body.models.map((m) => this.normalizeEntry(region, source, m, fetchedAt, sourceUrl));
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  private normalizeEntry(
    region: ModelReferenceRegion,
    source: ModelReferenceSource,
    model: ArenaLeaderboardModel,
    fetchedAt: Date,
    sourceUrl: string,
  ): ModelReferenceEntryInput {
    const normalizedModelName = model.model.trim().toLowerCase();
    return {
      region,
      source,
      normalizedModelName,
      sourceModelId: model.model,
      displayName: model.model,
      provider: model.vendor || null,
      scoresJson: {
        arenaElo: model.score,
        rank: model.rank,
        ci: model.ci,
        votes: model.votes,
      },
      priceJson: {},
      contextWindow: null,
      latencyMs: null,
      speedScore: null,
      sourceUrl,
      rawJson: { ...model },
      fetchedAt,
    };
  }
}
