import type { FastifyInstance } from 'fastify';
import {
  AuthenticationError,
  NoRouteAvailableError,
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
  isNormalizedError,
} from '@manageyourllm/shared';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (isNormalizedError(err)) {
      reply.status(statusFor(err)).send(err.toClientShape());
      return;
    }
    // 将 libsql/SQLite 唯一约束失败映射为可操作的 409 响应。
    if (isLibsqlUniqueError(err)) {
      req.log.warn({ err }, 'uniqueness conflict');
      reply.status(409).send({
        error: {
          message: `uniqueness conflict: ${err.message.split('\n')[0]}`,
          type: 'uniqueness_conflict',
          code: 'uniqueness_conflict',
        },
      });
      return;
    }
    req.log.error({ err }, 'unhandled error');
    reply.status(500).send({
      error: {
        message: 'Internal server error',
        type: 'internal_error',
        code: 'internal_error',
      },
    });
  });
}

function isLibsqlUniqueError(err: unknown): err is Error & { code: string; rawCode?: number } {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; rawCode?: unknown; name?: unknown };
  return e.code === 'SQLITE_CONSTRAINT_UNIQUE' || (e.name === 'LibsqlError' && e.rawCode === 2067);
}

function statusFor(err: unknown): number {
  if (err instanceof AuthenticationError) return 401;
  if (err instanceof PermissionError) return 403;
  if (err instanceof TargetNotFoundError) return 404;
  if (err instanceof ValidationError) return 400;
  if (err instanceof NoRouteAvailableError) return 503;
  if (err instanceof ProviderRateLimitError) return 429;
  if (err instanceof ProviderStreamError) return 501;
  // v1 Phase 5：错误分类细化，把 4xx 的语义回吐给客户端。
  if (err instanceof ProviderAuthError) return 401;
  if (err instanceof ProviderBadRequestError) return 400;
  if (err instanceof ProviderModelNotFoundError) return 404;
  // LiteLLM 借鉴：context window / content policy 直接回吐 400，不 failover。
  if (err instanceof ProviderContextWindowExceededError) return 400;
  if (err instanceof ProviderContentPolicyError) return 400;
  if (
    err instanceof ProviderError ||
    err instanceof ProviderOverloadedError ||
    err instanceof ProviderQuotaError ||
    err instanceof ProviderTimeoutError
  ) {
    return 502;
  }
  return 500;
}
