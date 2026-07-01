import { describe, it, expect } from 'vitest';
import {
  AuthenticationError,
  NoRouteAvailableError,
  NormalizedError,
  PermissionError,
  ProviderContentPolicyError,
  ProviderContextWindowExceededError,
  ProviderError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderStreamError,
  ProviderTimeoutError,
  TargetNotFoundError,
  ValidationError,
  isNormalizedError,
} from './errors.js';

describe('NormalizedError', () => {
  it('produces a client-safe shape', () => {
    const err = new ValidationError('bad input', { field: 'name' });
    expect(err.toClientShape()).toEqual({
      error: {
        message: 'bad input',
        type: 'ValidationError',
        code: 'validation_error',
        details: { field: 'name' },
      },
    });
  });

  it('identifies all concrete subclasses', () => {
    const errors = [
      new ValidationError(),
      new AuthenticationError(),
      new PermissionError(),
      new TargetNotFoundError(),
      new NoRouteAvailableError(),
      new ProviderError(),
      new ProviderRateLimitError(),
      new ProviderQuotaError(),
      new ProviderTimeoutError(),
      new ProviderStreamError(),
      new ProviderContextWindowExceededError(),
      new ProviderContentPolicyError(),
    ];
    for (const e of errors) {
      expect(isNormalizedError(e)).toBe(true);
      expect(e).toBeInstanceOf(NormalizedError);
    }
  });

  it('uses the code names required by the architecture', () => {
    expect(new ValidationError().code).toBe('validation_error');
    expect(new AuthenticationError().code).toBe('authentication_error');
    expect(new PermissionError().code).toBe('permission_error');
    expect(new TargetNotFoundError().code).toBe('target_not_found');
    expect(new NoRouteAvailableError().code).toBe('no_route_available');
    expect(new ProviderError().code).toBe('provider_error');
    expect(new ProviderRateLimitError().code).toBe('provider_rate_limit');
    expect(new ProviderQuotaError().code).toBe('provider_quota_exhausted');
    expect(new ProviderTimeoutError().code).toBe('provider_timeout');
    expect(new ProviderStreamError().code).toBe('provider_stream_error');
    expect(new ProviderContextWindowExceededError().code).toBe('provider_context_window_exceeded');
    expect(new ProviderContentPolicyError().code).toBe('provider_content_policy');
  });
});
