import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  type AppRow,
  type ConsumerKeyRow,
  type Db,
  type TargetType,
  modelGroups,
  publicModels,
  targetNames,
} from '../db/index.js';
import { listConsumerKeyAccess, requireConsumerKey } from '../auth/consumer-key.js';
import {
  handleAnthropicRequest,
  handleCodexRequest,
  handleOpenAIRequest,
  providerErrorToNormalized,
  touchUpstreamLastUsed,
} from './handler.js';
import { handleStreamRequest, buildStreamRequest } from './stream-handler.js';
import { generateTraceId } from '../observability/index.js';
import { irToAnthropicResponse, irToCodexResponse, irToOpenAIResponse } from './response-shapes.js';
import { anthropicErrorBody } from './error-shapes.js';
import type { NormalizedProviderError } from '../providers/index.js';
import {
  AuthenticationError,
  isNormalizedError,
  NoRouteAvailableError,
  TargetNotFoundError,
  ValidationError,
  type NormalizedError,
} from '@modelharbor/shared';

export interface GatewayRouteDeps {
  db: Db;
  secretKey: string;
}

interface ListModelsEntry {
  id: string;
  object: 'model';
  owned_by: 'modelharbor';
  metadata: { target_type: TargetType };
}

export function registerGatewayRoutes(app: FastifyInstance, deps: GatewayRouteDeps): void {
  const { db, secretKey } = deps;
  const guard = requireConsumerKey(db);

  // POST /v1/messages — Anthropic Messages-compatible endpoint. The handler
  // throws NormalizedError subclasses on bad input, missing target, denied
  // access, or no available route; we catch them here so the body matches
  // the Anthropic shape (the global error handler returns the OpenAI shape).
  app.post('/v1/messages', { preHandler: guard }, async (req, reply) => {
    const consumer = req as FastifyRequest & { consumerKey: ConsumerKeyRow; app: AppRow };
    const b = (req.body ?? {}) as Record<string, unknown>;
    const traceId = generateTraceId();
    if (b['stream'] === true) {
      try {
        const streamCtx = buildStreamRequest('anthropic', req.body);
        await handleStreamRequest(
          {
            db,
            secretKey,
            consumerKeyId: consumer.consumerKey.id,
            appId: consumer.app.id,
            traceId,
          },
          streamCtx,
          reply,
        );
      } catch (err) {
        if (isNormalizedError(err)) {
          sendNormalizedError(reply, 'anthropic', err);
          return reply;
        }
        throw err;
      }
      return reply;
    }
    try {
      const outcome = await handleAnthropicRequest(req.body, {
        db,
        secretKey,
        consumerKeyId: consumer.consumerKey.id,
        appId: consumer.app.id,
        traceId,
      });
      reply.header('X-Request-Trace-Id', traceId);
      if (outcome.ok) {
        void touchUpstreamLastUsed(db, outcome.candidate.upstreamKeyId);
        const body = irToAnthropicResponse(outcome.ir, { model: outcome.candidate.realModelName });
        return reply.send(body);
      }
      sendProviderError(reply, 'anthropic', outcome.providerError);
      return reply;
    } catch (err) {
      if (isNormalizedError(err)) {
        sendNormalizedError(reply, 'anthropic', err);
        return reply;
      }
      throw err;
    }
  });

  // POST /v1/chat/completions — OpenAI Chat Completions-compatible endpoint.
  // The global error handler already returns the OpenAI shape for
  // NormalizedError, but we still route provider errors through this handler
  // so the mapping stays in one place.
  app.post('/v1/chat/completions', { preHandler: guard }, async (req, reply) => {
    const consumer = req as FastifyRequest & { consumerKey: ConsumerKeyRow; app: AppRow };
    const b = (req.body ?? {}) as Record<string, unknown>;
    const traceId = generateTraceId();
    if (b['stream'] === true) {
      try {
        const streamCtx = buildStreamRequest('openai', req.body);
        await handleStreamRequest(
          {
            db,
            secretKey,
            consumerKeyId: consumer.consumerKey.id,
            appId: consumer.app.id,
            traceId,
          },
          streamCtx,
          reply,
        );
      } catch (err) {
        if (isNormalizedError(err)) {
          sendNormalizedError(reply, 'openai', err);
          return reply;
        }
        throw err;
      }
      return reply;
    }
    try {
      const outcome = await handleOpenAIRequest(req.body, {
        db,
        secretKey,
        consumerKeyId: consumer.consumerKey.id,
        appId: consumer.app.id,
        traceId,
      });
      reply.header('X-Request-Trace-Id', traceId);
      if (outcome.ok) {
        void touchUpstreamLastUsed(db, outcome.candidate.upstreamKeyId);
        const body = irToOpenAIResponse(outcome.ir, { model: outcome.candidate.realModelName });
        return reply.send(body);
      }
      sendProviderError(reply, 'openai', outcome.providerError);
      return reply;
    } catch (err) {
      if (isNormalizedError(err)) {
        sendNormalizedError(reply, 'openai', err);
        return reply;
      }
      throw err;
    }
  });

  // POST /v1/responses — OpenAI Responses API-compatible endpoint (Codex /
  // GPT-5.5+). This is a separate route from /v1/chat/completions because the
  // request/response shapes are materially different (`input` vs `messages`,
  // `output[]` vs `choices[]`). Provider errors are returned in the OpenAI
  // error shape so existing clients handle them consistently.
  app.post('/v1/responses', { preHandler: guard }, async (req, reply) => {
    const consumer = req as FastifyRequest & { consumerKey: ConsumerKeyRow; app: AppRow };
    const b = (req.body ?? {}) as Record<string, unknown>;
    const traceId = generateTraceId();
    if (b['stream'] === true) {
      try {
        const streamCtx = buildStreamRequest('codex', req.body);
        await handleStreamRequest(
          {
            db,
            secretKey,
            consumerKeyId: consumer.consumerKey.id,
            appId: consumer.app.id,
            traceId,
          },
          streamCtx,
          reply,
        );
      } catch (err) {
        if (isNormalizedError(err)) {
          sendNormalizedError(reply, 'codex', err);
          return reply;
        }
        throw err;
      }
      return reply;
    }
    try {
      const outcome = await handleCodexRequest(req.body, {
        db,
        secretKey,
        consumerKeyId: consumer.consumerKey.id,
        appId: consumer.app.id,
        traceId,
      });
      reply.header('X-Request-Trace-Id', traceId);
      if (outcome.ok) {
        void touchUpstreamLastUsed(db, outcome.candidate.upstreamKeyId);
        const body = irToCodexResponse(outcome.ir, { model: outcome.candidate.realModelName });
        return reply.send(body);
      }
      sendProviderError(reply, 'codex', outcome.providerError);
      return reply;
    } catch (err) {
      if (isNormalizedError(err)) {
        sendNormalizedError(reply, 'codex', err);
        return reply;
      }
      throw err;
    }
  });

  // GET /v1/models — list public models and groups the consumer key can access.
  app.get('/v1/models', { preHandler: guard }, async (req) => {
    const consumer = req as FastifyRequest & { consumerKey: ConsumerKeyRow; app: AppRow };
    const access = await listConsumerKeyAccess(db, consumer.consumerKey.id);
    const publicModelIds = access
      .filter((a) => a.targetType === 'public_model')
      .map((a) => a.targetId);
    const groupIds = access.filter((a) => a.targetType === 'model_group').map((a) => a.targetId);

    const data: ListModelsEntry[] = [];
    if (publicModelIds.length > 0) {
      const rows = await db
        .select()
        .from(publicModels)
        .where(and(inArray(publicModels.id, publicModelIds), eq(publicModels.enabled, true)))
        .all();
      for (const row of rows) {
        data.push({
          id: row.name,
          object: 'model',
          owned_by: 'modelharbor',
          metadata: { target_type: 'public_model' },
        });
      }
    }
    if (groupIds.length > 0) {
      const rows = await db
        .select()
        .from(modelGroups)
        .where(and(inArray(modelGroups.id, groupIds), eq(modelGroups.enabled, true)))
        .all();
      for (const row of rows) {
        data.push({
          id: row.name,
          object: 'model',
          owned_by: 'modelharbor',
          metadata: { target_type: 'model_group' },
        });
      }
    }
    data.sort((a, b) => (a.id < b.id ? -1 : 1));
    return { object: 'list', data };
  });
}

// Send a NormalizedProviderError as the wire-format response. M4 mapping:
// rate_limit → 429, timeout → 504, no_route_available → 503, target_not_found
// → 404, validation → 400, auth → 401, anything else provider_* → 502.
function sendProviderError(
  reply: FastifyReply,
  protocol: 'anthropic' | 'openai' | 'codex',
  providerError: NormalizedProviderError,
): void {
  const err = providerErrorToNormalized(providerError);
  const status = statusForNormalizedError(err);
  const message = err instanceof Error ? err.message : 'upstream error';
  if (protocol === 'anthropic') {
    reply.status(status).send(anthropicErrorBody(providerError, message));
    return;
  }
  // Codex clients understand the same error shape as OpenAI.
  reply.status(status).send({
    error: {
      message,
      type: err.name,
      code: (err as { code?: string }).code ?? 'upstream_error',
    },
  });
}

// Translate a NormalizedError (thrown by the handler) into the right wire shape
// for the calling protocol. OpenAI uses the default toClientShape(); Anthropic
// wraps the error in { type: "error", error: { type, message } }.
function sendNormalizedError(
  reply: FastifyReply,
  protocol: 'anthropic' | 'openai' | 'codex',
  err: NormalizedError,
): void {
  const status = statusForNormalizedError(err);
  if (protocol === 'anthropic') {
    reply.status(status).send({
      type: 'error',
      error: {
        type: anthropicTypeFor(err),
        message: err.message,
      },
    });
    return;
  }
  reply.status(status).send(err.toClientShape());
}

function anthropicTypeFor(err: NormalizedError): string {
  if (err instanceof TargetNotFoundError) return 'not_found_error';
  if (err instanceof NoRouteAvailableError) return 'overloaded_error';
  if (err instanceof ValidationError) return 'invalid_request_error';
  if (err instanceof AuthenticationError) return 'authentication_error';
  if ((err as { code?: string }).code === 'permission_error') return 'permission_error';
  return 'api_error';
}

function statusForNormalizedError(err: Error): number {
  if (err instanceof NoRouteAvailableError) return 503;
  if (err instanceof TargetNotFoundError) return 404;
  if (err instanceof ValidationError) return 400;
  if (err instanceof AuthenticationError) return 401;
  if ((err as { code?: string }).code === 'permission_error') return 403;
  if ((err as { code?: string }).code === 'provider_rate_limit') return 429;
  if ((err as { code?: string }).code === 'provider_timeout') return 504;
  if (isNormalizedError(err)) return 502;
  return 500;
}

// Pull the raw upstream id for logging in tests.
export async function getUpstreamIdForTarget(
  db: Db,
  targetType: TargetType,
  targetId: string,
): Promise<string | null> {
  const row = await db
    .select()
    .from(targetNames)
    .where(and(eq(targetNames.targetType, targetType), eq(targetNames.targetId, targetId)))
    .get();
  return row ? row.id : null;
}
