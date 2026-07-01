import { describe, it, expect } from 'vitest';
import {
  AuthenticationError,
  NoRouteAvailableError,
  NormalizedError,
  PermissionError,
  ProviderAuthError,
  ProviderBadRequestError,
  ProviderContentPolicyError,
  ProviderContextWindowExceededError,
  ProviderError,
  ProviderModelNotFoundError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderStreamError,
  ProviderTimeoutError,
  TargetNotFoundError,
  ValidationError,
  getErrorRoutingBehavior,
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

describe('getErrorRoutingBehavior', () => {
  it('context window / content policy: no failover, no cooldown', () => {
    expect(getErrorRoutingBehavior(new ProviderContextWindowExceededError())).toEqual({
      failover: false,
      countTowardsCooldown: false,
    });
    expect(getErrorRoutingBehavior(new ProviderContentPolicyError())).toEqual({
      failover: false,
      countTowardsCooldown: false,
    });
  });

  it('auth / bad_request / model_not_found: failover but no cooldown', () => {
    expect(getErrorRoutingBehavior(new ProviderAuthError())).toEqual({
      failover: true,
      countTowardsCooldown: false,
    });
    expect(getErrorRoutingBehavior(new ProviderBadRequestError())).toEqual({
      failover: true,
      countTowardsCooldown: false,
    });
    expect(getErrorRoutingBehavior(new ProviderModelNotFoundError())).toEqual({
      failover: true,
      countTowardsCooldown: false,
    });
  });

  it('stream error: failover but no cooldown', () => {
    expect(getErrorRoutingBehavior(new ProviderStreamError())).toEqual({
      failover: true,
      countTowardsCooldown: false,
    });
  });

  it('rate_limit / quota / overloaded / timeout: failover and cooldown', () => {
    expect(getErrorRoutingBehavior(new ProviderRateLimitError())).toEqual({
      failover: true,
      countTowardsCooldown: true,
    });
    expect(getErrorRoutingBehavior(new ProviderQuotaError())).toEqual({
      failover: true,
      countTowardsCooldown: true,
    });
    expect(getErrorRoutingBehavior(new ProviderOverloadedError())).toEqual({
      failover: true,
      countTowardsCooldown: true,
    });
    expect(getErrorRoutingBehavior(new ProviderTimeoutError())).toEqual({
      failover: true,
      countTowardsCooldown: true,
    });
  });

  it('ProviderError: failover; cooldown only for 5xx or network (no status)', () => {
    expect(getErrorRoutingBehavior(new ProviderError('5xx', { status: 503 }))).toEqual({
      failover: true,
      countTowardsCooldown: true,
    });
    expect(getErrorRoutingBehavior(new ProviderError('network'))).toEqual({
      failover: true,
      countTowardsCooldown: true,
    });
    expect(getErrorRoutingBehavior(new ProviderError('4xx', { status: 418 }))).toEqual({
      failover: true,
      countTowardsCooldown: false,
    });
  });

  it('non-provider NormalizedError: no failover, no cooldown', () => {
    expect(getErrorRoutingBehavior(new NoRouteAvailableError())).toEqual({
      failover: false,
      countTowardsCooldown: false,
    });
  });
});
