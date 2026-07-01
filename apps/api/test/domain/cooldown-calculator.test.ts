import { describe, it, expect } from 'vitest';
import { CooldownCalculator } from '../../src/domain/gateway/cooldown-calculator.js';
import {
  ProviderRateLimitError,
  ProviderError,
  ProviderContextWindowExceededError,
} from '@manageyourllm/shared';

describe('CooldownCalculator', () => {
  it('uses Retry-After from error details when present', () => {
    const calc = new CooldownCalculator();
    const err = new ProviderRateLimitError('rate limited', { retryAfterMs: 3_000 });
    const now = new Date();
    expect(calc.calculate(err, null, now)).toBe(3_000);
  });

  it('caps Retry-After at 8s', () => {
    const calc = new CooldownCalculator();
    const err = new ProviderRateLimitError('rate limited', { retryAfterMs: 15_000 });
    const now = new Date();
    expect(calc.calculate(err, null, now)).toBe(8_000);
  });

  it('starts at 1s base when no existing cooldown', () => {
    const calc = new CooldownCalculator({ random: () => 0.5 });
    const err = new ProviderError('503', { status: 503 });
    const now = new Date();
    expect(calc.calculate(err, null, now)).toBe(1_000); // 1000 * (0.75 + 0.5*0.5) = 1000
  });

  it('doubles remaining cooldown and applies jitter', () => {
    const calc = new CooldownCalculator({ random: () => 0.5 });
    const err = new ProviderError('503', { status: 503 });
    const now = new Date();
    const existing = new Date(now.getTime() + 2_000);
    expect(calc.calculate(err, existing, now)).toBe(4_000); // 2000*2 * 1.0 = 4000
  });

  it('caps doubled cooldown at 8s', () => {
    const calc = new CooldownCalculator({ random: () => 1 });
    const err = new ProviderError('503', { status: 503 });
    const now = new Date();
    const existing = new Date(now.getTime() + 6_000);
    // 6000*2 = 12000, jitter = 1.25 -> 15000, capped at 8000
    expect(calc.calculate(err, existing, now)).toBe(8_000);
  });

  it('ignores Retry-After for non-retriable errors if provided', () => {
    // 注意：调用方应只在 retriable failure 时调用 calculate；这里验证函数本身不额外过滤。
    const calc = new CooldownCalculator();
    const err = new ProviderContextWindowExceededError('too long', { retryAfterMs: 5_000 });
    const now = new Date();
    expect(calc.calculate(err, null, now)).toBe(5_000);
  });
});
