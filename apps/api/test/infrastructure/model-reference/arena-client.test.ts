import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ArenaModelReferenceClient } from '../../../src/infrastructure/model-reference/arena-client.js';
import fixture from '../../fixtures/arena-text.json' assert { type: 'json' };

describe('ArenaModelReferenceClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fixture,
    } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('normalizes arena leaderboard entries', async () => {
    const client = new ArenaModelReferenceClient();
    const entries = await client.fetch('global');

    expect(entries).toHaveLength(fixture.models.length);
    const first = entries[0]!;
    expect(first.region).toBe('global');
    expect(first.source).toBe('arena');
    expect(first.normalizedModelName).toBe(fixture.models[0]!.model.toLowerCase());
    expect(first.sourceModelId).toBe(fixture.models[0]!.model);
    expect(first.provider).toBe(fixture.models[0]!.vendor);
    expect(first.scoresJson.arenaElo).toBe(fixture.models[0]!.score);
    expect(first.scoresJson.rank).toBe(fixture.models[0]!.rank);
    expect(first.sourceUrl).toBe(fixture.meta.source_url);
  });

  it('throws on non-2xx response', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500 } as Response);
    const client = new ArenaModelReferenceClient();
    await expect(client.fetch('global')).rejects.toThrow('Arena API returned 500');
  });
});
