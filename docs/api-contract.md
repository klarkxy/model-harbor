# ModelHarbor API Contract

## Overview

ModelHarbor exposes two API families:

- Gateway APIs for client model calls.
- Admin APIs for the dashboard.

The MVP should keep response shapes stable enough for the web app and tests, but does not need to promise public backwards compatibility until the first tagged release.

## Authentication

### Gateway Authentication

Gateway requests use consumer keys.

Supported headers:

```text
Authorization: Bearer mh_...
```

For Anthropic-compatible clients, also accept:

```text
x-api-key: mh_...
```

If both are present, `Authorization` wins.

### Admin Authentication

Admin APIs use local admin sessions.

MVP options:

- HTTP-only signed session cookie.
- Or bearer session token for local development.

The browser dashboard should prefer HTTP-only cookies.

## Gateway APIs

### POST /v1/messages

Anthropic Messages-compatible endpoint.

Required request fields:

- `model`
- `messages`
- `max_tokens`

Supported MVP request fields:

- `model`
- `messages`
- `system`
- `max_tokens`
- `temperature`
- `top_p`
- `stream`
- `metadata`

Behavior:

- `model` can be a public model name or model group name.
- The route resolves through ModelHarbor permissions and routing.
- Streaming is supported when `stream: true`.

Response:

- Return Anthropic-compatible non-stream response for non-stream requests.
- Return Anthropic-compatible stream events for stream requests.

### POST /v1/chat/completions

OpenAI Chat Completions-compatible endpoint.

Required request fields:

- `model`
- `messages`

Supported MVP request fields:

- `model`
- `messages`
- `temperature`
- `top_p`
- `max_tokens`
- `stream`
- `metadata`

Behavior:

- `model` can be a public model name or model group name.
- The route resolves through ModelHarbor permissions and routing.
- SSE streaming is supported when `stream: true`.

Response:

- Return OpenAI-compatible chat completion response for non-stream requests.
- Return OpenAI-compatible SSE chunks for stream requests.

### POST /v1/responses

OpenAI Responses API-compatible endpoint (Codex / GPT-5.5+).

Required request fields:

- `model`
- `input`

Supported MVP request fields:

- `model`
- `input`
- `instructions` (system prompt)
- `max_output_tokens`
- `temperature`
- `top_p`
- `stream`
- `metadata`

Behavior:

- `model` can be a public model name or model group name.
- The route resolves through ModelHarbor permissions and routing.
- Streaming is supported when `stream: true`.

Response:

- Return OpenAI Responses-compatible non-stream response for non-stream requests.
- Return OpenAI Responses-compatible stream events for stream requests.

### GET /v1/models

Returns targets accessible to the current consumer key.

Response shape:

```json
{
  "object": "list",
  "data": [
    {
      "id": "coding",
      "object": "model",
      "owned_by": "modelharbor",
      "metadata": {
        "target_type": "model_group"
      }
    }
  ]
}
```

Notes:

- Public models and groups both appear as models to clients.
- Internal upstream details are not exposed.

## Gateway Error Shape

Use protocol-compatible errors where possible.

Common status codes:

- `401`: missing or invalid consumer key.
- `403`: consumer key is not allowed to access the requested target.
- `404`: requested model or group does not exist.
- `429`: selected upstream key is rate-limited and no fallback is available.
- `503`: no route is available.
- `502`: upstream provider failed.

Error body may use the OpenAI-compatible shape for `/v1/chat/completions`:

```json
{
  "error": {
    "message": "No available upstream route",
    "type": "no_route_available",
    "code": "no_route_available"
  }
}
```

For `/v1/messages`, return an Anthropic-compatible error shape when practical:

```json
{
  "type": "error",
  "error": {
    "type": "not_found_error",
    "message": "Model not found"
  }
}
```

Never include raw upstream API keys or internal stack traces.

## Admin APIs

All admin APIs live under:

```text
/api/admin
```

### Auth

#### POST /api/admin/auth/login

Request:

```json
{
  "username": "admin",
  "password": "secret"
}
```

Response:

```json
{
  "admin": {
    "id": "adm_...",
    "username": "admin",
    "displayName": "Admin"
  }
}
```

#### POST /api/admin/auth/logout

Invalidates the current admin session.

#### GET /api/admin/auth/me

Returns the current admin user.

### Upstream Keys

#### GET /api/admin/upstream-keys

Returns upstream keys without raw secret values.

#### POST /api/admin/upstream-keys

Request:

```json
{
  "name": "DeepSeek key 1",
  "providerType": "anthropic_compatible",
  "baseUrl": "https://api.example.com",
  "apiKey": "sk-...",
  "supportedModels": ["ds-v4-flash"],
  "quota": {
    "period": "month",
    "requestLimit": 100000,
    "inputTokenLimit": 10000000,
    "outputTokenLimit": 10000000,
    "totalTokenLimit": 20000000
  }
}
```

Response:

```json
{
  "id": "uk_...",
  "name": "DeepSeek key 1",
  "providerType": "anthropic_compatible",
  "apiKeyPrefix": "sk-...abcd",
  "enabled": true,
  "frozen": false
}
```

#### PATCH /api/admin/upstream-keys/:id

Updates non-secret fields and quota settings.

#### POST /api/admin/upstream-keys/:id/rotate-secret

Replaces the upstream API key.

#### POST /api/admin/upstream-keys/:id/freeze

Manually freezes a key.

#### POST /api/admin/upstream-keys/:id/unfreeze

Manually unfreezes a key when policy allows it.

### Public Models

#### GET /api/admin/public-models

Lists public models.

#### POST /api/admin/public-models

Request:

```json
{
  "name": "ds-v4-flash",
  "displayName": "DS V4 Flash",
  "description": "Fast coding model",
  "candidates": [
    {
      "upstreamKeyId": "uk_...",
      "realModelName": "ds-v4-flash",
      "priority": 100,
      "weight": 1
    }
  ]
}
```

Behavior:

- Reject if `name` conflicts with an existing public model or model group.

#### PATCH /api/admin/public-models/:id

Updates public model metadata.

#### PUT /api/admin/public-models/:id/candidates

Replaces candidate list transactionally.

### Model Groups

#### GET /api/admin/model-groups

Lists model groups.

#### POST /api/admin/model-groups

Request:

```json
{
  "name": "coding",
  "displayName": "Coding",
  "description": "Coding-focused route group",
  "routingPolicy": "priority",
  "members": [
    {
      "publicModelId": "pm_...",
      "priority": 100,
      "weight": 1
    }
  ]
}
```

Behavior:

- Reject if `name` conflicts with an existing public model or model group.

#### PATCH /api/admin/model-groups/:id

Updates group metadata.

#### PUT /api/admin/model-groups/:id/members

Replaces group member list transactionally.

### Apps

#### GET /api/admin/apps

Lists apps.

#### POST /api/admin/apps

Request:

```json
{
  "name": "Local IDE",
  "description": "Developer tools and coding agents"
}
```

Apps have no quota or rate-limit settings.

#### PATCH /api/admin/apps/:id

Updates app metadata.

### Consumer Keys

#### GET /api/admin/apps/:appId/consumer-keys

Lists consumer keys for an app.

#### POST /api/admin/apps/:appId/consumer-keys

Request:

```json
{
  "name": "Cline key",
  "access": [
    {
      "targetType": "model_group",
      "targetId": "mg_..."
    }
  ]
}
```

Response:

```json
{
  "id": "ck_...",
  "name": "Cline key",
  "key": "mh_...",
  "keyPrefix": "mh_...abcd"
}
```

Notes:

- `key` is returned only once.
- Consumer keys have no quota or rate-limit settings.

#### POST /api/admin/consumer-keys/:id/revoke

Revokes a consumer key.

#### POST /api/admin/consumer-keys/:id/rotate

Rotates and returns a new raw key once.

#### PUT /api/admin/consumer-keys/:id/access

Replaces access grants transactionally.

### Observability

#### GET /api/admin/usage/totals

Query parameters: `window` (`today`, `24h`, `7d`).

Returns aggregated totals for requests, tokens, failures, latency, and sticky hit rate.

#### GET /api/admin/usage/by-app

Query parameters: `window`. Returns per-app usage breakdown.

#### GET /api/admin/usage/by-consumer-key

Query parameters: `window`. Returns per-consumer-key breakdown.

#### GET /api/admin/usage/by-upstream-key

Query parameters: `window`. Returns per-upstream-key breakdown.

#### GET /api/admin/usage/by-target

Query parameters: `window`. Returns per-public-model / per-group breakdown.

#### GET /api/admin/usage/recent

Query parameters: `limit` (max 500, default 100).

Returns recent usage records with request, target, upstream key, latency, and status.

## Naming And IDs

MVP can use string IDs with prefixes:

- `adm_`
- `app_`
- `ck_`
- `uk_`
- `pm_`
- `mg_`

Public `name` fields used by clients should be lowercase-friendly and URL-safe:

```text
a-z A-Z 0-9 . _ -
```

The UI may allow display names with wider characters, including Chinese.
