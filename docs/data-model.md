# ModelHarbor Data Model

## Principles

- SQLite is the first database target.
- Drizzle owns schema and migrations.
- Store secrets safely and never return raw keys after creation.
- Apps and consumer keys are attribution and permission objects, not quota objects.
- All quotas and rate limits are scoped to upstream keys.
- Public model names and model group names share one namespace.

## Tables

### admin_users

Stores local dashboard administrators.

Fields:

- `id`
- `username`
- `passwordHash`
- `displayName`
- `enabled`
- `createdAt`
- `updatedAt`
- `lastLoginAt`

Constraints:

- `username` unique.

### admin_sessions

Stores local admin login sessions.

Fields:

- `id`
- `adminUserId`
- `sessionHash`
- `expiresAt`
- `createdAt`
- `lastSeenAt`

Constraints:

- `sessionHash` unique.
- Delete expired sessions in a background job.

### apps

Application-level tenant boundary.

Fields:

- `id`
- `name`
- `description`
- `enabled`
- `createdAt`
- `updatedAt`

Constraints:

- `name` unique among non-deleted apps.
- No quota or rate-limit columns.

### consumer_keys

Authenticates client requests and attributes usage to an app.

Fields:

- `id`
- `appId`
- `name`
- `keyHash`
- `keyPrefix`
- `enabled`
- `revokedAt`
- `lastUsedAt`
- `createdAt`
- `updatedAt`

Constraints:

- `keyHash` unique.
- No quota or rate-limit columns.

Notes:

- Raw consumer key is shown only once on create or rotate.
- Store a short non-secret prefix for dashboard display.

### consumer_key_access

Grants a consumer key access to public models or model groups.

Fields:

- `id`
- `consumerKeyId`
- `targetType`
- `targetId`
- `createdAt`

Constraints:

- Unique on `consumerKeyId + targetType + targetId`.
- `targetType` is `public_model` or `model_group`.

### upstream_keys

Actual routable provider instances.

Fields:

- `id`
- `name`
- `providerType`
- `baseUrl`
- `apiKeyCiphertext`
- `apiKeyPrefix`
- `defaultHeadersJson`
- `supportedModelsJson`
- `enabled`
- `frozen`
- `frozenReason`
- `cooldownUntil`
- `lastHealthStatus`
- `lastErrorCode`
- `lastErrorMessage`
- `lastUsedAt`
- `createdAt`
- `updatedAt`

Constraints:

- `name` unique among non-deleted upstream keys.

Notes:

- `providerType` starts with `anthropic_compatible` and `openai_compatible`.
- `supportedModelsJson` is acceptable for MVP; a normalized table can be introduced later if needed.
- Raw upstream API key is never returned after creation.

### upstream_key_quotas

Defines quota and rate-limit policy for an upstream key.

Fields:

- `id`
- `upstreamKeyId`
- `period`
- `requestLimit`
- `inputTokenLimit`
- `outputTokenLimit`
- `totalTokenLimit`
- `enabled`
- `createdAt`
- `updatedAt`

Constraints:

- One active quota policy per upstream key for MVP.
- RPM and TPM tracking are not implemented in the current milestone; rate-limit events are handled through cooldowns.

### upstream_key_counters

Tracks usage counters for upstream keys.

Fields:

- `id`
- `upstreamKeyId`
- `period`
- `periodStartedAt`
- `periodEndsAt`
- `requestCount`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `createdAt`
- `updatedAt`

Constraints:

- Unique on `upstreamKeyId + period + periodStartedAt`.

### target_names

Shared namespace for public model names and model group names.

Fields:

- `id`
- `name`
- `targetType`
- `targetId`
- `createdAt`

Constraints:

- `name` unique.
- `targetType` is `public_model` or `model_group`.

Notes:

- This table makes cross-table uniqueness explicit in SQLite.
- Create or update public models and groups through transactions that maintain this table.

### public_models

Client-facing model names.

Fields:

- `id`
- `name`
- `displayName`
- `description`
- `enabled`
- `createdAt`
- `updatedAt`

Constraints:

- `name` must exist in `target_names`.

### public_model_candidates

Maps a public model to upstream candidates.

Fields:

- `id`
- `publicModelId`
- `upstreamKeyId`
- `realModelName`
- `enabled`
- `priority`
- `weight`
- `createdAt`
- `updatedAt`

Constraints:

- Unique on `publicModelId + upstreamKeyId + realModelName`.

### model_groups

Administrator-defined groups.

Fields:

- `id`
- `name`
- `displayName`
- `description`
- `enabled`
- `routingPolicy`
- `createdAt`
- `updatedAt`

Constraints:

- `name` must exist in `target_names`.

### model_group_members

Adds public models to model groups.

Fields:

- `id`
- `modelGroupId`
- `publicModelId`
- `enabled`
- `priority`
- `weight`
- `createdAt`
- `updatedAt`

Constraints:

- Unique on `modelGroupId + publicModelId`.

### sticky_bindings

Stores weak sticky routing decisions.

Fields:

- `id`
- `appId`
- `consumerKeyId`
- `requestedTargetName`
- `conversationFingerprint`
- `upstreamKeyId`
- `realModelName`
- `hitCount`
- `lastUsedAt`
- `expiresAt`
- `createdAt`
- `updatedAt`

Constraints:

- Unique on `appId + consumerKeyId + requestedTargetName + conversationFingerprint`.

Notes:

- Binding reuse must still validate that the upstream key and real model are current valid candidates.

### usage_records

One record per gateway request.

Fields:

- `id`
- `appId`
- `consumerKeyId`
- `requestedTargetName`
- `resolvedTargetType`
- `resolvedTargetId`
- `upstreamKeyId`
- `realModelName`
- `sourceProtocol`
- `providerType`
- `stream`
- `stickyHit`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `status`
- `errorCode`
- `latencyMs`
- `createdAt`

Notes:

- Store metadata and statistics only by default.
- Do not store prompt or completion bodies unless an explicit future admin setting enables it.

## Secret Handling

Consumer keys:

- Hash before storing.
- Show raw value only once.
- Store prefix for identification.

Upstream keys:

- Encrypt at rest when an encryption secret is configured.
- Show prefix only after creation.
- Never log raw values.

Admin sessions:

- Store session hashes, not raw session tokens.
