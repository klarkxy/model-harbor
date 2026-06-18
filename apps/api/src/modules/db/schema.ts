import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { ProviderType, SourceProtocol } from '@modelharbor/shared';

// --- Admin (M1) ---

export const adminUsers = sqliteTable('admin_users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
});

export const adminSessions = sqliteTable(
  'admin_sessions',
  {
    id: text('id').primaryKey(),
    adminUserId: text('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    sessionHash: text('session_hash').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('admin_sessions_admin_idx').on(t.adminUserId),
    index('admin_sessions_expires_idx').on(t.expiresAt),
  ],
);

// --- Apps / consumer keys (M2) ---

export const TARGET_TYPES = ['public_model', 'model_group'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const apps = sqliteTable('apps', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const consumerKeys = sqliteTable(
  'consumer_keys',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: text('key_prefix').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('consumer_keys_app_idx').on(t.appId)],
);

export const consumerKeyAccess = sqliteTable(
  'consumer_key_access',
  {
    id: text('id').primaryKey(),
    consumerKeyId: text('consumer_key_id')
      .notNull()
      .references(() => consumerKeys.id, { onDelete: 'cascade' }),
    targetType: text('target_type', { enum: TARGET_TYPES }).notNull(),
    targetId: text('target_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('consumer_key_access_unique').on(t.consumerKeyId, t.targetType, t.targetId),
    index('consumer_key_access_target_idx').on(t.targetType, t.targetId),
  ],
);

// --- Upstream keys and quotas ---

export const PROVIDER_TYPES = [
  'anthropic_compatible',
  'openai_compatible',
] as const satisfies readonly ProviderType[];

export const QUOTA_PERIODS = ['hour', 'day', 'week', 'month', 'total'] as const;
export type QuotaPeriod = (typeof QUOTA_PERIODS)[number];

export const upstreamKeys = sqliteTable('upstream_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  providerType: text('provider_type', { enum: PROVIDER_TYPES }).notNull(),
  baseUrl: text('base_url').notNull(),
  apiKeyCiphertext: text('api_key_ciphertext').notNull(),
  apiKeyPrefix: text('api_key_prefix').notNull(),
  defaultHeadersJson: text('default_headers_json'),
  supportedModelsJson: text('supported_models_json').notNull().default('[]'),
  endpointsJson: text('endpoints_json'),
  providerPresetId: text('provider_preset_id'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  frozen: integer('frozen', { mode: 'boolean' }).notNull().default(false),
  frozenReason: text('frozen_reason'),
  cooldownUntil: integer('cooldown_until', { mode: 'timestamp_ms' }),
  lastHealthStatus: text('last_health_status'),
  lastErrorCode: text('last_error_code'),
  lastErrorMessage: text('last_error_message'),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const upstreamKeyQuotas = sqliteTable('upstream_key_quotas', {
  id: text('id').primaryKey(),
  upstreamKeyId: text('upstream_key_id')
    .notNull()
    .unique()
    .references(() => upstreamKeys.id, { onDelete: 'cascade' }),
  period: text('period', { enum: QUOTA_PERIODS }).notNull(),
  requestLimit: integer('request_limit'),
  inputTokenLimit: integer('input_token_limit'),
  outputTokenLimit: integer('output_token_limit'),
  totalTokenLimit: integer('total_token_limit'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- Quota counters (M6) ---
//
// One row per (upstream key, period, current period window). The router engine
// increments the matching row on every successful (or attempted) gateway call;
// a row at quota freezes the upstream key. The window starts at the period
// boundary and ends at the next boundary; rows past their period are reset by
// the jobs runner.
export const upstreamKeyCounters = sqliteTable(
  'upstream_key_counters',
  {
    id: text('id').primaryKey(),
    upstreamKeyId: text('upstream_key_id')
      .notNull()
      .references(() => upstreamKeys.id, { onDelete: 'cascade' }),
    period: text('period', { enum: QUOTA_PERIODS }).notNull(),
    periodStartedAt: integer('period_started_at', { mode: 'timestamp_ms' }).notNull(),
    periodEndsAt: integer('period_ends_at', { mode: 'timestamp_ms' }).notNull(),
    requestCount: integer('request_count').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('upstream_key_counter_window').on(t.upstreamKeyId, t.period, t.periodStartedAt),
    index('upstream_key_counter_upstream_idx').on(t.upstreamKeyId),
  ],
);

// --- Public models and model groups (shared target namespace) ---

export const targetNames = sqliteTable('target_names', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  targetType: text('target_type', { enum: TARGET_TYPES }).notNull(),
  targetId: text('target_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const publicModels = sqliteTable('public_models', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name'),
  description: text('description'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const publicModelCandidates = sqliteTable(
  'public_model_candidates',
  {
    id: text('id').primaryKey(),
    publicModelId: text('public_model_id')
      .notNull()
      .references(() => publicModels.id, { onDelete: 'cascade' }),
    upstreamKeyId: text('upstream_key_id')
      .notNull()
      .references(() => upstreamKeys.id, { onDelete: 'cascade' }),
    realModelName: text('real_model_name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    priority: integer('priority').notNull().default(100),
    weight: integer('weight').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('public_model_candidate_unique').on(
      t.publicModelId,
      t.upstreamKeyId,
      t.realModelName,
    ),
    index('public_model_candidate_upstream_idx').on(t.upstreamKeyId),
  ],
);

export const modelGroups = sqliteTable('model_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name'),
  description: text('description'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  routingPolicy: text('routing_policy').notNull().default('priority'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const modelGroupMembers = sqliteTable(
  'model_group_members',
  {
    id: text('id').primaryKey(),
    modelGroupId: text('model_group_id')
      .notNull()
      .references(() => modelGroups.id, { onDelete: 'cascade' }),
    publicModelId: text('public_model_id')
      .notNull()
      .references(() => publicModels.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    priority: integer('priority').notNull().default(100),
    weight: integer('weight').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('model_group_member_unique').on(t.modelGroupId, t.publicModelId)],
);

// --- Usage records (M5+) ---

// One row per gateway request (non-stream or stream). The sticky_hit flag is
// set when a sticky binding was honored. Aggregations land in M7.
export const usageRecords = sqliteTable(
  'usage_records',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    consumerKeyId: text('consumer_key_id')
      .notNull()
      .references(() => consumerKeys.id, { onDelete: 'cascade' }),
    requestedTargetName: text('requested_target_name').notNull(),
    resolvedTargetType: text('resolved_target_type', { enum: TARGET_TYPES }).notNull(),
    resolvedTargetId: text('resolved_target_id').notNull(),
    upstreamKeyId: text('upstream_key_id')
      .notNull()
      .references(() => upstreamKeys.id, { onDelete: 'cascade' }),
    realModelName: text('real_model_name').notNull(),
    sourceProtocol: text('source_protocol').notNull(),
    providerType: text('provider_type', { enum: PROVIDER_TYPES }).notNull(),
    stream: integer('stream', { mode: 'boolean' }).notNull().default(false),
    stickyHit: integer('sticky_hit', { mode: 'boolean' }).notNull().default(false),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('usage_records_created_at_idx').on(t.createdAt),
    index('usage_records_app_idx').on(t.appId, t.createdAt),
    index('usage_records_consumer_idx').on(t.consumerKeyId, t.createdAt),
    index('usage_records_upstream_idx').on(t.upstreamKeyId, t.createdAt),
  ],
);

// --- Audit events (post-M7 hardening) ---

// One row per admin-side action worth auditing. MVP records: login success /
// failure, upstream key create/update/freeze/unfreeze/rotate, public model
// create/update/delete, model group create/update/delete, consumer key
// create/revoke/rotate/access-update. Resource ids are stored as text so the
// row is safe to keep even after the underlying record is deleted.
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actorAdminId: text('actor_admin_id'),
    actorUsername: text('actor_username'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    // JSON-encoded details (resource name, previous state, etc.). Never
    // contains raw secrets — the audit module redacts mh_ / sk- / Bearer
    // tokens before persisting.
    detailsJson: text('details_json'),
    ip: text('ip'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('audit_events_created_at_idx').on(t.createdAt),
    index('audit_events_actor_idx').on(t.actorAdminId),
    index('audit_events_resource_idx').on(t.resourceType, t.resourceId),
  ],
);

// --- Login rate limiting (post-M7 hardening) ---

// Rolling window of admin login attempts. The rate limiter looks at rows in
// the last `LOGIN_WINDOW_MS`; failures over the cap return 429 without
// touching the password code path. Successful logins don't write here.
export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    ip: text('ip').notNull(),
    success: integer('success', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('login_attempts_created_at_idx').on(t.createdAt),
    index('login_attempts_username_idx').on(t.username, t.createdAt),
    index('login_attempts_ip_idx').on(t.ip, t.createdAt),
  ],
);

// --- Sticky bindings (M6) ---
//
// One row per (appId, consumerKeyId, requestedTargetName, conversationFingerprint).
// Stores the upstream key + real model the gateway should pin this conversation
// to, plus a sliding `expiresAt` and a hit counter. Sticky is a weak guarantee:
// the gateway re-validates the bound upstream is still a usable candidate before
// honoring the binding; otherwise it picks a new candidate and updates the row.
export const stickyBindings = sqliteTable(
  'sticky_bindings',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    consumerKeyId: text('consumer_key_id')
      .notNull()
      .references(() => consumerKeys.id, { onDelete: 'cascade' }),
    requestedTargetName: text('requested_target_name').notNull(),
    conversationFingerprint: text('conversation_fingerprint').notNull(),
    upstreamKeyId: text('upstream_key_id')
      .notNull()
      .references(() => upstreamKeys.id, { onDelete: 'cascade' }),
    realModelName: text('real_model_name').notNull(),
    hitCount: integer('hit_count').notNull().default(0),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('sticky_binding_unique').on(
      t.appId,
      t.consumerKeyId,
      t.requestedTargetName,
      t.conversationFingerprint,
    ),
    index('sticky_binding_consumer_idx').on(t.consumerKeyId, t.requestedTargetName),
    index('sticky_binding_expires_idx').on(t.expiresAt),
  ],
);

// --- Inferred row types ---

export type AdminUserRow = typeof adminUsers.$inferSelect;
export type AdminUserInsert = typeof adminUsers.$inferInsert;
export type AdminSessionRow = typeof adminSessions.$inferSelect;
export type AdminSessionInsert = typeof adminSessions.$inferInsert;
export type AppRow = typeof apps.$inferSelect;
export type AppInsert = typeof apps.$inferInsert;
export type ConsumerKeyRow = typeof consumerKeys.$inferSelect;
export type ConsumerKeyInsert = typeof consumerKeys.$inferInsert;
export type ConsumerKeyAccessRow = typeof consumerKeyAccess.$inferSelect;
export type ConsumerKeyAccessInsert = typeof consumerKeyAccess.$inferInsert;
export type UpstreamKeyRow = typeof upstreamKeys.$inferSelect;
export type UpstreamKeyInsert = typeof upstreamKeys.$inferInsert;
export type UpstreamKeyQuotaRow = typeof upstreamKeyQuotas.$inferSelect;
export type UpstreamKeyQuotaInsert = typeof upstreamKeyQuotas.$inferInsert;
export type UpstreamKeyCounterRow = typeof upstreamKeyCounters.$inferSelect;
export type UpstreamKeyCounterInsert = typeof upstreamKeyCounters.$inferInsert;
export type TargetNameRow = typeof targetNames.$inferSelect;
export type TargetNameInsert = typeof targetNames.$inferInsert;
export type PublicModelRow = typeof publicModels.$inferSelect;
export type PublicModelInsert = typeof publicModels.$inferInsert;
export type PublicModelCandidateRow = typeof publicModelCandidates.$inferSelect;
export type PublicModelCandidateInsert = typeof publicModelCandidates.$inferInsert;
export type ModelGroupRow = typeof modelGroups.$inferSelect;
export type ModelGroupInsert = typeof modelGroups.$inferInsert;
export type ModelGroupMemberRow = typeof modelGroupMembers.$inferSelect;
export type ModelGroupMemberInsert = typeof modelGroupMembers.$inferInsert;
export type UsageRecordRow = typeof usageRecords.$inferSelect;
export type UsageRecordInsert = typeof usageRecords.$inferInsert;
export type StickyBindingRow = typeof stickyBindings.$inferSelect;
export type StickyBindingInsert = typeof stickyBindings.$inferInsert;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type AuditEventInsert = typeof auditEvents.$inferInsert;
export type LoginAttemptRow = typeof loginAttempts.$inferSelect;
export type LoginAttemptInsert = typeof loginAttempts.$inferInsert;

// Re-export SourceProtocol as part of the db surface for convenience
export type { SourceProtocol };
