import type { NormalizedError } from '@manageyourllm/shared';

export interface CooldownCalculatorDeps {
  /** 可注入的随机源，便于测试时固定 jitter */
  random?: () => number;
}

/**
 * 计算单次 per-candidate cooldown 时长。
 *
 * 算法（LiteLLM 借鉴）：
 * 1. 如果上游响应携带 `Retry-After` 头（已由 adapter 解析为 error.details.retryAfterMs），
 *    优先使用，但封顶 `maxCooldownMs`。
 * 2. 否则按指数退避：已有剩余冷却则翻倍，否则从 base 开始；再叠加 ±25% jitter。
 * 3. 最终结果封顶 `maxCooldownMs`。
 *
 * v1 固定参数：base=1s, max=8s。未来可从 settings 读取。
 */
export class CooldownCalculator {
  private readonly random: () => number;
  private readonly baseMs = 1_000;
  private readonly maxMs = 8_000;

  constructor(deps: CooldownCalculatorDeps = {}) {
    this.random = deps.random ?? Math.random;
  }

  calculate(error: NormalizedError, existingCooldownUntil: Date | null, now: Date): number {
    const retryAfterMs = this.parseRetryAfter(error);
    if (retryAfterMs !== undefined && retryAfterMs > 0) {
      return Math.min(retryAfterMs, this.maxMs);
    }

    const remainingMs =
      existingCooldownUntil && existingCooldownUntil > now
        ? existingCooldownUntil.getTime() - now.getTime()
        : 0;

    const nextMs = remainingMs > 0 ? remainingMs * 2 : this.baseMs;
    const jitter = 0.75 + this.random() * 0.5; // ±25%
    return Math.min(Math.round(nextMs * jitter), this.maxMs);
  }

  private parseRetryAfter(error: NormalizedError): number | undefined {
    const raw = error.details?.['retryAfterMs'];
    if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
    return undefined;
  }
}
