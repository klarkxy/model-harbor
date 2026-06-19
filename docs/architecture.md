# ModelHarbor Architecture

## Overview

ModelHarbor is a single deployable service with clear internal separation between the control plane and the data plane.

- The control plane powers the admin dashboard and manages configuration state.
- The data plane handles client-facing model API traffic.
- Provider adapters isolate protocol and vendor differences from the router core.
- Shared schemas keep the API, UI, router, and tests aligned.

The first implementation should be a monorepo:

```text
apps/
  api/
  web/
packages/
  shared/
```

## Runtime Shape

The first version runs as one process or one container:

```text
client
  -> /v1/messages
  -> /v1/chat/completions
  -> /v1/responses
  -> /v1/models
  -> Fastify gateway
  -> router core
  -> provider adapter
  -> upstream provider

admin browser
  -> /admin
  -> Vue dashboard
  -> /api/admin/*
  -> Fastify admin API
  -> database
```

The code should still keep gateway traffic and admin traffic separated so a future version can split them into different processes.

## Suggested Package Boundaries

### apps/api

Owns the HTTP server, database access, gateway routes, admin routes, and background jobs.

Recommended modules:

```text
apps/api/src/
  server/
  config/
  db/
  auth/
  admin/
  gateway/
  router/
  providers/
  upstream/
  quota/
  sticky/
  usage/
  observability/
  jobs/
```

Responsibilities:

- Start Fastify.
- Serve admin API routes.
- Serve gateway routes.
- Serve built web assets in production.
- Read and write database state.
- Run quota reset, cooldown cleanup, health-check jobs, and upstream endpoint health probes.

### apps/web

Owns the Vue and Naive UI admin dashboard.

Recommended modules:

```text
apps/web/src/
  app/
  router/
  stores/
  api/
  layouts/
  pages/
  components/
```

Dashboard pages should follow administrator workflows:

- Upstream Keys.
- Public Models.
- Model Groups.
- Apps.
- Consumer Keys.
- Observability.
- Settings.

### packages/shared

Owns shared TypeScript types, validation schemas, route contracts, constants, and protocol-neutral request shapes.

Recommended modules:

```text
packages/shared/src/
  schemas/
  contracts/
  protocols/
  capabilities/
  errors/
```

This package should not import server-only or browser-only dependencies.

## Data Plane Flow

For `POST /v1/messages`, `POST /v1/chat/completions`, and `POST /v1/responses`:

1. Authenticate the consumer key.
2. Resolve the owning app.
3. Parse the incoming request into an internal chat request shape.
4. Resolve the requested model name as either a public model or model group.
5. Check consumer-key access permissions.
6. Expand the target into `UpstreamKey + realModelName` candidates.
7. Remove disabled, frozen, cooled-down, over-quota, incompatible, or circuit-breaker-open candidates; then sort the remainder by endpoint health (non-degraded, lowest latency first).
8. Compute the conversation fingerprint from stable message prefixes.
9. Reuse a sticky binding if it points to a still-valid candidate.
10. Otherwise select a candidate through the route policy and update the binding.
11. Convert the internal request with the selected provider adapter.
12. Send the upstream request.
13. Convert response or stream events back to the client protocol.
14. Record usage metadata and token counts.
15. Update quota counters and freeze or cool down the upstream key if needed.

Availability always takes priority over stickiness.

## Internal Request Shape

Do not convert Anthropic requests into OpenAI requests or OpenAI requests into Anthropic requests directly. Convert both into a protocol-neutral internal representation.

Initial internal shape:

```text
ChatRequestIR
- sourceProtocol
- requestedModel
- system
- messages
- tools
- toolChoice
- maxTokens
- temperature
- topP
- stream
- metadata
- rawRequest
```

Initial message shape:

```text
ChatMessageIR
- role
- content
```

Content should support text first. Keep the type open for future image, tool, and structured content blocks.

## Provider Adapter Interface

Each provider adapter owns vendor-specific behavior.

Minimum interface:

```text
ProviderAdapter
- type
- capabilities
- buildRequest(context)
- send(request)
- normalizeResponse(response)
- normalizeStream(event)
- normalizeError(error)
- extractUsage(responseOrEvent)
```

Adapter responsibilities:

- Authentication headers.
- Base URL and path construction.
- Request body conversion.
- Response body conversion.
- Streaming event conversion.
- Error normalization.
- Token usage extraction.
- Provider capability declarations.

MVP adapters:

- Anthropic-compatible.
- OpenAI-compatible.
- Codex (OpenAI Responses API).

The router core must not contain provider-specific request fields except through adapter capabilities.

## Control Plane Flow

Admin changes should go through explicit APIs, not direct file edits.

Important operations:

- Create, update, disable, freeze, unfreeze, and delete upstream keys.
- Create and update public models.
- Attach upstream candidates to public models.
- Create and update model groups.
- Attach public models to groups.
- Create apps.
- Create, revoke, and rotate consumer keys.
- Assign accessible models and groups to consumer keys.
- View usage, routing, error, and sticky-hit statistics.

All destructive admin actions should be soft-delete or disable-first in MVP unless there is a clear reason to hard-delete.

## Database Model Groups

The first schema should include these model groups:

- Admin users and sessions.
- Apps.
- Consumer keys and access grants.
- Upstream keys.
- Public models.
- Public model candidates.
- Model groups.
- Model group members.
- Sticky bindings.
- Usage records.
- Quota counters.
- Audit events.

Security-sensitive fields:

- Store consumer keys as hashes.
- Store upstream API keys encrypted at rest if a local encryption secret is configured.
- Never return raw upstream API keys after creation.

## State And Caching

SQLite is the source of truth in MVP.

In-process caches may be used for:

- Enabled upstream keys.
- Model and group resolution.
- Consumer key lookup after hash verification.
- Provider capability metadata.

Cache invalidation must be explicit after admin writes.

Sticky bindings, quota counters, and cooldown state should be stored durably enough that a restart does not lose essential routing behavior. In-memory acceleration is acceptable, but database state should remain authoritative for MVP.

Circuit breaker state (`circuit_breakers`) and endpoint health (`upstream_endpoint_health`) are also persisted in SQLite so that routing decisions survive restarts.

## Streaming

Streaming is a first-class requirement.

The gateway must:

- Preserve streaming behavior for Anthropic Messages.
- Preserve SSE streaming behavior for OpenAI Chat Completions.
- Convert upstream provider stream events back to the client-facing protocol.
- Record final usage when the provider sends usage in a terminal event.
- Record partial failure metadata if a stream fails after headers have been sent.
- Support first-token timeout failover: when multiple candidates exist and `firstTokenTimeoutMs` is configured, race the first SSE event against the timeout, cancel the slow upstream on timeout, and continue the stream from the next candidate.

Streaming tests should use fake upstream servers rather than live providers.

## Error Handling

Use normalized error classes internally:

```text
AuthenticationError
PermissionError
TargetNotFoundError
NoRouteAvailableError
ProviderError
ProviderRateLimitError
ProviderQuotaError
ProviderTimeoutError
ProviderStreamError
ValidationError
```

Gateway behavior:

- Authentication failures return 401.
- Permission failures return 403.
- Unknown model or group returns 404 or provider-compatible model-not-found shape.
- No available upstream route returns 503.
- Provider failures can trigger retry, cooldown, or route rebinding depending on error type.

Do not expose upstream API keys, full provider error bodies with secrets, or internal stack traces.

## Observability

Every gateway request should produce one usage record.

Usage records should include:

- App.
- Consumer key.
- Requested target name.
- Resolved target type.
- Public model or group.
- Upstream key.
- Real model name.
- Source protocol.
- Provider type.
- Input tokens.
- Output tokens.
- Total tokens.
- Stream flag.
- Status.
- Error code.
- Latency.
- Sticky hit flag.
- Created timestamp.

Default logging stores metadata only. Prompt and completion content logging is optional and administrator-controlled.

## Frontend Architecture

Use Naive UI as the primary UI layer.

Frontend rules:

- Use `n-data-table` for tabular admin objects.
- Use `n-form` for create and edit flows.
- Use `n-drawer` or `n-modal` for focused edits.
- Use `n-tabs` for detail pages.
- Use `n-tag`, `n-badge`, and `n-statistic` for state and summary display.
- Avoid custom CSS except app shell layout, spacing constraints, and small page-level adjustments.

The dashboard should not expose YAML, adapter internals, or routing engine terminology when a simpler admin term exists.

## Deployment

MVP deployment:

- One Docker image.
- One SQLite database file mounted as persistent data.
- One environment variable or setup wizard for the initial admin secret.
- Admin dashboard served from the same origin as the API.

Future deployment options:

- Postgres.
- Redis-backed counters and sticky state.
- Split gateway and admin processes.
- Multiple gateway instances.

The MVP should not require Kubernetes.
