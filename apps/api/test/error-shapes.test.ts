import { describe, it, expect } from 'vitest';
import { anthropicErrorBody } from '../src/modules/gateway/error-shapes.js';
import type { NormalizedProviderError } from '../src/modules/providers/types.js';

function err(partial: Partial<NormalizedProviderError> = {}): NormalizedProviderError {
  return {
    category: 'provider_unknown',
    providerCode: 'unknown',
    providerMessage: 'something went wrong',
    upstreamStatus: 500,
    ...partial,
  };
}

describe('anthropicErrorBody', () => {
  it('maps each error category to the right Anthropic type', () => {
    const cases: Array<[NormalizedProviderError['category'], string]> = [
      ['provider_authentication', 'authentication_error'],
      ['provider_permission', 'permission_error'],
      ['provider_rate_limit', 'rate_limit_error'],
      ['provider_quota', 'quota_error'],
      ['provider_timeout', 'timeout_error'],
      ['provider_overloaded', 'overloaded_error'],
      ['provider_model_not_found', 'not_found_error'],
      ['provider_bad_request', 'invalid_request_error'],
      ['provider_stream_error', 'api_error'],
    ];
    for (const [category, expectedType] of cases) {
      const body = anthropicErrorBody(err({ category }), 'fallback');
      expect(body.type).toBe('error');
      expect(body.error.type).toBe(expectedType);
    }
  });

  it('defaults unknown category to api_error', () => {
    const body = anthropicErrorBody(err({ category: 'provider_unknown' }), 'fb');
    expect(body.error.type).toBe('api_error');
  });

  it('prefers providerMessage over fallback', () => {
    const body = anthropicErrorBody(
      err({ category: 'provider_rate_limit', providerMessage: 'too many requests' }),
      'fallback',
    );
    expect(body.error.message).toBe('too many requests');
  });

  it('keeps empty providerMessage as-is (nullish coalescing only)', () => {
    const body = anthropicErrorBody(
      err({ category: 'provider_rate_limit', providerMessage: '' }),
      'rate limit hit',
    );
    // ?? only triggers on null/undefined, so empty string passes through.
    expect(body.error.message).toBe('');
  });

  it('falls back when providerMessage is undefined', () => {
    const e = err({ category: 'provider_rate_limit' });
    (e as { providerMessage: string | undefined }).providerMessage = undefined;
    const body = anthropicErrorBody(e, 'fb');
    expect(body.error.message).toBe('fb');
  });
});
