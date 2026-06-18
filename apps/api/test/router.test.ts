import { describe, expect, it } from 'vitest';
import { type ResolvedCandidate, filterCandidates } from '../src/modules/router/candidates.js';
import { selectCandidateByPriority } from '../src/modules/router/policy.js';

function candidate(overrides: Partial<ResolvedCandidate> = {}): ResolvedCandidate {
  return {
    upstreamKeyId: 'uk_a',
    upstreamKeyName: 'A',
    providerType: 'anthropic_compatible',
    baseUrl: 'https://a.example.com',
    apiKeyCiphertext: 'ct',
    realModelName: 'm',
    upstreamEnabled: true,
    upstreamFrozen: false,
    cooldownUntil: null,
    priority: 100,
    weight: 1,
    publicModelId: 'pm_1',
    publicModelName: 'p',
    candidateEnabled: true,
    publicModelEnabled: true,
    endpointProtocol: overrides.providerType
      ? overrides.providerType === 'openai_compatible'
        ? 'openai'
        : 'anthropic'
      : 'anthropic',
    endpointBaseUrl: overrides.baseUrl ?? 'https://a.example.com',
    endpointsJson: null,
    ...overrides,
  };
}

describe('filterCandidates', () => {
  it('drops a disabled candidate row', () => {
    const res = filterCandidates([candidate({ candidateEnabled: false })], {
      sourceProtocol: 'anthropic',
      now: new Date(),
    });
    expect(res.accepted).toHaveLength(0);
    expect(res.dropped[0]?.reason).toBe('candidate_disabled');
  });

  it('drops a disabled public model', () => {
    const res = filterCandidates([candidate({ publicModelEnabled: false })], {
      sourceProtocol: 'anthropic',
      now: new Date(),
    });
    expect(res.accepted).toHaveLength(0);
    expect(res.dropped[0]?.reason).toBe('public_model_disabled');
  });

  it('drops a disabled upstream key', () => {
    const res = filterCandidates([candidate({ upstreamEnabled: false })], {
      sourceProtocol: 'anthropic',
      now: new Date(),
    });
    expect(res.accepted).toHaveLength(0);
    expect(res.dropped[0]?.reason).toBe('upstream_disabled');
  });

  it('drops a frozen upstream key', () => {
    const res = filterCandidates([candidate({ upstreamFrozen: true })], {
      sourceProtocol: 'anthropic',
      now: new Date(),
    });
    expect(res.accepted).toHaveLength(0);
    expect(res.dropped[0]?.reason).toBe('upstream_frozen');
  });

  it('drops an upstream in cooldown', () => {
    const future = new Date(Date.now() + 60_000);
    const res = filterCandidates([candidate({ cooldownUntil: future })], {
      sourceProtocol: 'anthropic',
      now: new Date(),
    });
    expect(res.accepted).toHaveLength(0);
    expect(res.dropped[0]?.reason).toBe('upstream_cooldown');
  });

  it('accepts an upstream whose cooldown has already expired', () => {
    const past = new Date(Date.now() - 60_000);
    const res = filterCandidates([candidate({ cooldownUntil: past })], {
      sourceProtocol: 'anthropic',
      now: new Date(),
    });
    expect(res.accepted).toHaveLength(1);
    expect(res.dropped).toHaveLength(0);
  });

  it('keeps a cross-protocol candidate as fallback instead of dropping it', () => {
    const res = filterCandidates([candidate({ providerType: 'openai_compatible' })], {
      sourceProtocol: 'anthropic',
      now: new Date(),
    });
    expect(res.accepted).toHaveLength(0);
    expect(res.dropped).toHaveLength(0);
    expect(res.fallback).toHaveLength(1);
    expect(res.fallback[0]?.endpointProtocol).toBe('openai');
  });

  it('prefers same-protocol candidates over cross-protocol fallback', () => {
    const same = candidate({ upstreamKeyId: 'uk_same', providerType: 'anthropic_compatible' });
    const cross = candidate({ upstreamKeyId: 'uk_cross', providerType: 'openai_compatible' });
    const res = filterCandidates([same, cross], { sourceProtocol: 'anthropic', now: new Date() });
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0]?.upstreamKeyId).toBe('uk_same');
    expect(res.fallback).toHaveLength(1);
    expect(res.fallback[0]?.upstreamKeyId).toBe('uk_cross');
  });
});

describe('selectCandidateByPriority', () => {
  it('returns the candidate with the lowest priority', () => {
    const a = candidate({ upstreamKeyId: 'uk_a', priority: 100 });
    const b = candidate({ upstreamKeyId: 'uk_b', priority: 50 });
    const c = candidate({ upstreamKeyId: 'uk_c', priority: 200 });
    const pick = selectCandidateByPriority([a, b, c]);
    expect(pick.upstreamKeyId).toBe('uk_b');
  });

  it('is stable on tiebreak by upstreamKeyId then realModelName', () => {
    const a = candidate({ upstreamKeyId: 'uk_a', realModelName: 'x', priority: 100 });
    const b = candidate({ upstreamKeyId: 'uk_b', realModelName: 'x', priority: 100 });
    const c = candidate({ upstreamKeyId: 'uk_b', realModelName: 'y', priority: 100 });
    const pick1 = selectCandidateByPriority([a, b, c]);
    const pick2 = selectCandidateByPriority([c, b, a]);
    expect(pick1.upstreamKeyId).toBe('uk_a');
    expect(pick2.upstreamKeyId).toBe('uk_a');
  });

  it('throws on an empty list', () => {
    expect(() => selectCandidateByPriority([])).toThrow();
  });
});
