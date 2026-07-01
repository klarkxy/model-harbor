export class NormalizedError extends Error {
  readonly code: string;
  readonly type: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.type = this.constructor.name;
    if (details !== undefined) {
      this.details = details;
    }
  }

  toClientShape(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      error: {
        message: this.message,
        type: this.type,
        code: this.code,
      },
    };
    if (this.details !== undefined) {
      (body.error as Record<string, unknown>).details = this.details;
    }
    return body;
  }
}

export class ValidationError extends NormalizedError {
  constructor(message = 'Validation failed', details?: Record<string, unknown>) {
    super('validation_error', message, details);
  }
}

export class AuthenticationError extends NormalizedError {
  constructor(message = 'Authentication failed', details?: Record<string, unknown>) {
    super('authentication_error', message, details);
  }
}

export class PermissionError extends NormalizedError {
  constructor(message = 'Permission denied', details?: Record<string, unknown>) {
    super('permission_error', message, details);
  }
}

export class TargetNotFoundError extends NormalizedError {
  constructor(message = 'Target not found', details?: Record<string, unknown>) {
    super('target_not_found', message, details);
  }
}

export class NoRouteAvailableError extends NormalizedError {
  constructor(message = 'No available upstream route', details?: Record<string, unknown>) {
    super('no_route_available', message, details);
  }
}

export class ProviderError extends NormalizedError {
  constructor(message = 'Upstream provider error', details?: Record<string, unknown>) {
    super('provider_error', message, details);
  }
}

/**
 * 上游认证/权限错误：401 / 403 / 含 'permission' / 'forbidden' / 'insufficient_user' 等 code。
 *
 * v1 Phase 5：这一类只进入 Trace 和配置风险提示，不进入 cooldown / breaker，
 * 避免"单个账号 key 过期"把整个 provider account 的所有 candidate 全打掉。
 */
export class ProviderAuthError extends NormalizedError {
  constructor(
    message = 'Upstream authentication or permission error',
    details?: Record<string, unknown>,
  ) {
    super('provider_auth', message, details);
  }
}

/**
 * 上游 bad_request：400 / 422 / 含 'invalid_request_error' 等。
 *
 * v1 Phase 5：不计入 cooldown / breaker —— 请求体错误是客户端请求侧的，
 * 不应让上游 candidate 因此被熔断。
 */
export class ProviderBadRequestError extends NormalizedError {
  constructor(message = 'Upstream bad request', details?: Record<string, unknown>) {
    super('provider_bad_request', message, details);
  }
}

/**
 * 上游 model_not_found：404 且错误信息明确指 model 不存在。
 *
 * v1 Phase 5：不计入 cooldown / breaker —— 这通常是 candidate 配置错误
 * （realModelName 填错），冷却上游无意义，应该让用户在 Trace/Models 页看到。
 */
export class ProviderModelNotFoundError extends NormalizedError {
  constructor(message = 'Upstream model not found', details?: Record<string, unknown>) {
    super('provider_model_not_found', message, details);
  }
}

/**
 * 上游 overloaded：529 / 含 'overloaded' / 'capacity' code。
 * 计入 cooldown / breaker —— 临时性过载应该让该 candidate 退避一段时间。
 */
export class ProviderOverloadedError extends NormalizedError {
  constructor(message = 'Upstream overloaded', details?: Record<string, unknown>) {
    super('provider_overloaded', message, details);
  }
}

export class ProviderRateLimitError extends NormalizedError {
  constructor(message = 'Upstream rate limit', details?: Record<string, unknown>) {
    super('provider_rate_limit', message, details);
  }
}

export class ProviderQuotaError extends NormalizedError {
  constructor(message = 'Upstream quota exhausted', details?: Record<string, unknown>) {
    super('provider_quota_exhausted', message, details);
  }
}

export class ProviderTimeoutError extends NormalizedError {
  constructor(message = 'Upstream timeout', details?: Record<string, unknown>) {
    super('provider_timeout', message, details);
  }
}

export class ProviderStreamError extends NormalizedError {
  constructor(message = 'Upstream stream error', details?: Record<string, unknown>) {
    super('provider_stream_error', message, details);
  }
}

/**
 * 上游 context window 超限：prompt 太长导致无法放入模型上下文。
 *
 * 这一类错误**不 failover**（换其他 candidate 也不会让 prompt 变短），也**不计入 cooldown / breaker**。
 * 来源：LiteLLM `ContextWindowExceededError`。
 */
export class ProviderContextWindowExceededError extends NormalizedError {
  constructor(message = 'Context window exceeded', details?: Record<string, unknown>) {
    super('provider_context_window_exceeded', message, details);
  }
}

/**
 * 上游内容策略违规：触发 moderation / safety / content filter。
 *
 * 这一类错误**不 failover**（换其他 candidate 通常也会因同样内容触发策略），也**不计入 cooldown / breaker**。
 * 来源：LiteLLM `ContentPolicyViolationError`。
 */
export class ProviderContentPolicyError extends NormalizedError {
  constructor(message = 'Content policy violation', details?: Record<string, unknown>) {
    super('provider_content_policy', message, details);
  }
}

export function isNormalizedError(err: unknown): err is NormalizedError {
  return err instanceof NormalizedError;
}
