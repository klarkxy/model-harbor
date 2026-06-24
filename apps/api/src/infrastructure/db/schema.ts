import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { ProviderType, SourceProtocol } from '@manageyourllm/shared';
import type { ProviderDescriptor } from '@manageyourllm/shared';

// 目标类型：公共模型或模型组，共享同一个命名空间。
export const TARGET_TYPES = ['public_model', 'model_group'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

// Provider 类型与认证类型，与共享包保持一致。
export const PROVIDER_TYPES = [
  'anthropic_compatible',
  'openai_compatible',
  'coze',
  'codex',
  'deepseek',
  'moonshot',
  'minimax',
  'openrouter',
  'groq',
  'fireworks',
  'together',
] as const satisfies readonly ProviderType[];

export const UPSTREAM_AUTH_TYPES = ['pat', 'oauth'] as const;
export type UpstreamAuthType = (typeof UPSTREAM_AUTH_TYPES)[number];

export const QUOTA_PERIODS = ['hour', 'day', 'week', 'month', 'total'] as const;
export type QuotaPeriod = (typeof QUOTA_PERIODS)[number];

export const PLAN_TYPES = ['token', 'coding'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

export const BACKUP_TYPES = ['full', 'config'] as const;
export type BackupType = (typeof BACKUP_TYPES)[number];

// --- 管理员认证 ---

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

export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    ip: text('ip').notNull(),
    success: integer('success', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('login_attempts_created_at_idx').on(t.createdAt),
    index('login_attempts_username_idx').on(t.username, t.createdAt),
    index('login_attempts_ip_idx').on(t.ip, t.createdAt),
  ],
);

// --- 系统设置（单例） ---

export const adminSettings = sqliteTable('admin_settings', {
  id: text('id').primaryKey(),
  circuitBreakerEnabled: integer('circuit_breaker_enabled', { mode: 'boolean' })
    .notNull()
    .default(true),
  circuitBreakerFailureThreshold: integer('circuit_breaker_failure_threshold').notNull().default(5),
  circuitBreakerBaseCooldownMs: integer('circuit_breaker_base_cooldown_ms')
    .notNull()
    .default(60_000),
  circuitBreakerMaxCooldownMs: integer('circuit_breaker_max_cooldown_ms')
    .notNull()
    .default(600_000),
  circuitBreakerHalfOpenSuccessCount: integer('circuit_breaker_half_open_success_count')
    .notNull()
    .default(2),
  endpointHealthProbeEnabled: integer('endpoint_health_probe_enabled', { mode: 'boolean' })
    .notNull()
    .default(true),
  endpointHealthProbeIntervalMs: integer('endpoint_health_probe_interval_ms')
    .notNull()
    .default(3_600_000),
  endpointHealthProbeTimeoutMs: integer('endpoint_health_probe_timeout_ms')
    .notNull()
    .default(10_000),
  endpointHealthProbeDegradedLatencyMs: integer('endpoint_health_probe_degraded_latency_ms')
    .notNull()
    .default(5_000),
  firstTokenTimeoutMs: integer('first_token_timeout_ms').notNull().default(15_000),
  contentLogEnabled: integer('content_log_enabled', { mode: 'boolean' }).notNull().default(false),
  contentLogRetentionDays: integer('content_log_retention_days').notNull().default(7),
  contentLogMaxPayloadBytes: integer('content_log_max_payload_bytes').notNull().default(100_000),
  publicEndpointsBasePath: text('public_endpoints_base_path').notNull().default('/v1'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- 应用与 Consumer Key ---

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
    keySuffix: text('key_suffix').notNull().default(''),
    accessMode: text('access_mode', { enum: ['all', 'restricted'] as const })
      .notNull()
      .default('all'),
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

// --- Provider Preset（仅本地自定义 preset 落库；内置 preset 由共享包提供） ---

export const providerPresets = sqliteTable('provider_presets', {
  id: text('id').primaryKey(),
  source: text('source', { enum: ['builtin', 'local'] as const })
    .notNull()
    .default('local'),
  name: text('name').notNull(),
  providerType: text('provider_type', { enum: PROVIDER_TYPES }).notNull(),
  descriptorJson: text('descriptor_json', { mode: 'json' }).$type<ProviderDescriptor>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- 上游 Key ---

export const upstreamKeys = sqliteTable('upstream_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  providerPresetId: text('provider_preset_id'),
  providerType: text('provider_type', { enum: PROVIDER_TYPES }).notNull(),
  baseUrl: text('base_url').notNull(),
  authType: text('auth_type', { enum: UPSTREAM_AUTH_TYPES }).notNull().default('pat'),
  apiKeyCiphertext: text('api_key_ciphertext').notNull(),
  apiKeyPrefix: text('api_key_prefix').notNull(),
  authConfigCiphertext: text('auth_config_ciphertext'),
  defaultHeadersJson: text('default_headers_json', { mode: 'json' }).$type<
    Record<string, string>
  >(),
  extraHeadersJson: text('extra_headers_json', { mode: 'json' }).$type<Record<string, string>>(),
  extraParamsJson: text('extra_params_json', { mode: 'json' }).$type<Record<string, unknown>>(),
  supportedModelsJson: text('supported_models_json', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default([]),
  endpointsJson: text('endpoints_json', { mode: 'json' }).$type<unknown[]>(),
  displayOrder: integer('display_order').notNull().default(1000),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  frozen: integer('frozen', { mode: 'boolean' }).notNull().default(false),
  frozenReason: text('frozen_reason'),
  cooldownUntil: integer('cooldown_until', { mode: 'timestamp_ms' }),
  lastHealthStatus: text('last_health_status'),
  lastErrorCode: text('last_error_code'),
  lastErrorMessage: text('last_error_message'),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  stickySessionTtlMs: integer('sticky_session_ttl_ms')
    .notNull()
    .default(5 * 60 * 1000),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const upstreamKeyQuotas = sqliteTable(
  'upstream_key_quotas',
  {
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
  },
  (t) => [index('upstream_key_quotas_key_idx').on(t.upstreamKeyId)],
);

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

export const upstreamEndpointHealth = sqliteTable(
  'upstream_endpoint_health',
  {
    id: text('id').primaryKey(),
    upstreamKeyId: text('upstream_key_id')
      .notNull()
      .references(() => upstreamKeys.id, { onDelete: 'cascade' }),
    endpointBaseUrl: text('endpoint_base_url').notNull(),
    delayMs: integer('delay_ms'),
    lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }),
    degraded: integer('degraded', { mode: 'boolean' }).notNull().default(false),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('upstream_endpoint_health_unique').on(t.upstreamKeyId, t.endpointBaseUrl),
    index('upstream_endpoint_health_key_idx').on(t.upstreamKeyId),
    index('upstream_endpoint_health_degraded_idx').on(t.degraded, t.delayMs),
    index('upstream_endpoint_health_checked_idx').on(t.lastCheckedAt),
  ],
);

// --- 目标命名空间与模型暴露 ---

export const targetNames = sqliteTable(
  'target_names',
  {
    name: text('name').primaryKey(),
    targetType: text('target_type', { enum: TARGET_TYPES }).notNull(),
    targetId: text('target_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('target_names_target_idx').on(t.targetType, t.targetId)],
);

export const publicModels = sqliteTable('public_models', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name'),
  description: text('description'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  candidateOrderCustomized: integer('candidate_order_customized', { mode: 'boolean' })
    .notNull()
    .default(false),
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
    pingLatencyMs: integer('ping_latency_ms'),
    pingStatus: text('ping_status'),
    endpointUrl: text('endpoint_url'),
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
  roundRobinCounter: integer('round_robin_counter').notNull().default(0),
  mode: text('mode', { enum: ['manual', 'auto_snapshot'] as const })
    .notNull()
    .default('manual'),
  autoPreset: text('auto_preset'),
  autoRegion: text('auto_region'),
  autoTopN: integer('auto_top_n'),
  autoLastRefreshedAt: integer('auto_last_refreshed_at', { mode: 'timestamp_ms' }),
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

// --- 路由状态 ---

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

export const stickySessions = sqliteTable(
  'sticky_sessions',
  {
    id: text('id').primaryKey(),
    consumerKeyId: text('consumer_key_id')
      .notNull()
      .references(() => consumerKeys.id, { onDelete: 'cascade' }),
    requestedTargetName: text('requested_target_name').notNull(),
    upstreamKeyId: text('upstream_key_id')
      .notNull()
      .references(() => upstreamKeys.id, { onDelete: 'cascade' }),
    realModelName: text('real_model_name').notNull(),
    ttlMs: integer('ttl_ms').notNull(),
    hitCount: integer('hit_count').notNull().default(0),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('sticky_session_unique').on(t.consumerKeyId, t.requestedTargetName),
    index('sticky_session_consumer_idx').on(t.consumerKeyId, t.requestedTargetName),
    index('sticky_session_expires_idx').on(t.expiresAt),
  ],
);

export const circuitBreakers = sqliteTable(
  'circuit_breakers',
  {
    id: text('id').primaryKey(),
    upstreamKeyId: text('upstream_key_id')
      .notNull()
      .references(() => upstreamKeys.id, { onDelete: 'cascade' }),
    realModelName: text('real_model_name').notNull(),
    state: text('state', { enum: ['closed', 'open', 'half_open'] as const })
      .notNull()
      .default('closed'),
    failureCount: integer('failure_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    openCount: integer('open_count').notNull().default(0),
    openedAt: integer('opened_at', { mode: 'timestamp_ms' }),
    cooldownUntil: integer('cooldown_until', { mode: 'timestamp_ms' }),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('circuit_breaker_unique').on(t.upstreamKeyId, t.realModelName),
    index('circuit_breaker_state_idx').on(t.state, t.cooldownUntil),
    index('circuit_breaker_updated_idx').on(t.updatedAt),
  ],
);

// --- 可观测性 ---

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
    sessionStickyHit: integer('session_sticky_hit', { mode: 'boolean' }).notNull().default(false),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    latencyMs: integer('latency_ms').notNull(),
    costAmount: integer('cost_amount'),
    costCurrency: text('cost_currency'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('usage_records_created_at_idx').on(t.createdAt),
    index('usage_records_app_idx').on(t.appId, t.createdAt),
    index('usage_records_consumer_idx').on(t.consumerKeyId, t.createdAt),
    index('usage_records_upstream_idx').on(t.upstreamKeyId, t.createdAt),
  ],
);

export const requestTraceLogs = sqliteTable(
  'request_trace_logs',
  {
    id: text('id').primaryKey(),
    requestTraceId: text('request_trace_id').notNull(),
    step: text('step').notNull(),
    stepIndex: integer('step_index').notNull(),
    appId: text('app_id'),
    consumerKeyId: text('consumer_key_id'),
    requestedTargetName: text('requested_target_name'),
    upstreamKeyId: text('upstream_key_id'),
    realModelName: text('real_model_name'),
    status: text('status'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    detailsJson: text('details_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('request_trace_logs_trace_id_idx').on(t.requestTraceId),
    index('request_trace_logs_created_at_idx').on(t.createdAt),
    index('request_trace_logs_consumer_idx').on(t.consumerKeyId, t.createdAt),
    index('request_trace_logs_upstream_idx').on(t.upstreamKeyId, t.createdAt),
  ],
);

export const debugContentLogs = sqliteTable(
  'debug_content_logs',
  {
    id: text('id').primaryKey(),
    requestTraceId: text('request_trace_id'),
    promptJson: text('prompt_json', { mode: 'json' }).$type<unknown>(),
    responseJson: text('response_json', { mode: 'json' }).$type<unknown>(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('debug_content_logs_trace_id_idx').on(t.requestTraceId),
    index('debug_content_logs_created_at_idx').on(t.createdAt),
  ],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actorAdminId: text('actor_admin_id'),
    actorUsername: text('actor_username'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    detailsJson: text('details_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    ip: text('ip'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('audit_events_created_at_idx').on(t.createdAt),
    index('audit_events_actor_idx').on(t.actorAdminId),
    index('audit_events_resource_idx').on(t.resourceType, t.resourceId),
  ],
);

export const dailyConsumptionStats = sqliteTable(
  'daily_consumption_stats',
  {
    id: text('id').primaryKey(),
    upstreamKeyId: text('upstream_key_id').notNull(),
    realModelName: text('real_model_name').notNull(),
    dayDate: text('day_date').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    avgLatencyMs: integer('avg_latency_ms').notNull().default(0),
    totalCostAmount: integer('total_cost_amount').notNull().default(0),
    costCurrency: text('cost_currency').notNull().default('USD'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('daily_consumption_stats_unique').on(t.upstreamKeyId, t.realModelName, t.dayDate),
    index('daily_consumption_stats_day_idx').on(t.dayDate),
    index('daily_consumption_stats_upstream_idx').on(t.upstreamKeyId, t.dayDate),
  ],
);

// --- 模型参考 ---

export const MODEL_REFERENCE_REGIONS = ['global'] as const;
export type ModelReferenceRegion = (typeof MODEL_REFERENCE_REGIONS)[number];

export const MODEL_REFERENCE_SOURCES = ['rele'] as const;
export type ModelReferenceSource = (typeof MODEL_REFERENCE_SOURCES)[number];

export const modelReferenceEntries = sqliteTable(
  'model_reference_entries',
  {
    id: text('id').primaryKey(),
    region: text('region', { enum: MODEL_REFERENCE_REGIONS }).notNull(),
    source: text('source', { enum: MODEL_REFERENCE_SOURCES }).notNull(),
    normalizedModelName: text('normalized_model_name').notNull(),
    sourceModelId: text('source_model_id').notNull(),
    displayName: text('display_name').notNull(),
    provider: text('provider'),
    scoresJson: text('scores_json', { mode: 'json' })
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    priceJson: text('price_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    contextWindow: integer('context_window'),
    latencyMs: integer('latency_ms'),
    speedScore: integer('speed_score'),
    sourceUrl: text('source_url'),
    rawJson: text('raw_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('model_reference_entry_unique').on(t.region, t.source, t.normalizedModelName),
    index('model_reference_entry_region_idx').on(t.region, t.source),
  ],
);

export const modelReferenceSyncStatus = sqliteTable(
  'model_reference_sync_status',
  {
    id: text('id').primaryKey(),
    region: text('region', { enum: MODEL_REFERENCE_REGIONS }).notNull(),
    source: text('source', { enum: MODEL_REFERENCE_SOURCES }).notNull(),
    status: text('status', { enum: ['idle', 'refreshing', 'success', 'error'] as const })
      .notNull()
      .default('idle'),
    lastRefreshAt: integer('last_refresh_at', { mode: 'timestamp_ms' }),
    nextRefreshAfter: integer('next_refresh_after', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    ttlMs: integer('ttl_ms').notNull().default(86_400_000),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('model_reference_sync_unique').on(t.region, t.source),
    index('model_reference_sync_region_idx').on(t.region),
  ],
);

// --- 成本账本 ---

export const pricingEntries = sqliteTable(
  'pricing_entries',
  {
    id: text('id').primaryKey(),
    providerType: text('provider_type', { enum: PROVIDER_TYPES }).notNull(),
    upstreamKeyId: text('upstream_key_id').references(() => upstreamKeys.id, {
      onDelete: 'cascade',
    }),
    realModelName: text('real_model_name').notNull(),
    inputPricePer1k: integer('input_price_per_1k').notNull(),
    outputPricePer1k: integer('output_price_per_1k').notNull(),
    currency: text('currency').notNull().default('USD'),
    effectiveFrom: integer('effective_from', { mode: 'timestamp_ms' }).notNull(),
    effectiveUntil: integer('effective_until', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('pricing_entries_provider_idx').on(t.providerType, t.realModelName),
    index('pricing_entries_upstream_idx').on(t.upstreamKeyId, t.realModelName),
  ],
);

export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    planType: text('plan_type', { enum: PLAN_TYPES }).notNull(),
    name: text('name').notNull(),
    providerType: text('provider_type', { enum: PROVIDER_TYPES }),
    upstreamKeyId: text('upstream_key_id').references(() => upstreamKeys.id, {
      onDelete: 'cascade',
    }),
    totalAmount: integer('total_amount').notNull(),
    usedAmount: integer('used_amount').notNull().default(0),
    remainingAmount: integer('remaining_amount').notNull(),
    unit: text('unit').notNull(),
    period: text('period').notNull(),
    purchasedAt: integer('purchased_at', { mode: 'timestamp_ms' }).notNull(),
    validFrom: integer('valid_from', { mode: 'timestamp_ms' }).notNull(),
    validUntil: integer('valid_until', { mode: 'timestamp_ms' }),
    reminderDays: integer('reminder_days').notNull().default(7),
    notes: text('notes'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('plans_type_idx').on(t.planType),
    index('plans_upstream_idx').on(t.upstreamKeyId),
    index('plans_valid_until_idx').on(t.validUntil),
  ],
);

// --- 备份 ---

export const backups = sqliteTable(
  'backups',
  {
    id: text('id').primaryKey(),
    filename: text('filename').notNull().unique(),
    type: text('type', { enum: BACKUP_TYPES }).notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    schemaVersion: integer('schema_version').notNull(),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('backups_created_at_idx').on(t.createdAt)],
);

// --- 迁移记录 ---

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: integer('version').primaryKey(),
  appliedAt: integer('applied_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- 推断类型导出 ---

export type AdminUserRow = typeof adminUsers.$inferSelect;
export type AdminUserInsert = typeof adminUsers.$inferInsert;
export type AdminSessionRow = typeof adminSessions.$inferSelect;
export type AdminSessionInsert = typeof adminSessions.$inferInsert;
export type LoginAttemptRow = typeof loginAttempts.$inferSelect;
export type LoginAttemptInsert = typeof loginAttempts.$inferInsert;
export type AppRow = typeof apps.$inferSelect;
export type AppInsert = typeof apps.$inferInsert;
export type ConsumerKeyRow = typeof consumerKeys.$inferSelect;
export type ConsumerKeyInsert = typeof consumerKeys.$inferInsert;
export type ConsumerKeyAccessRow = typeof consumerKeyAccess.$inferSelect;
export type ConsumerKeyAccessInsert = typeof consumerKeyAccess.$inferInsert;
export type ProviderPresetRow = typeof providerPresets.$inferSelect;
export type ProviderPresetInsert = typeof providerPresets.$inferInsert;
export type UpstreamKeyRow = typeof upstreamKeys.$inferSelect;
export type UpstreamKeyInsert = typeof upstreamKeys.$inferInsert;
export type UpstreamKeyQuotaRow = typeof upstreamKeyQuotas.$inferSelect;
export type UpstreamKeyQuotaInsert = typeof upstreamKeyQuotas.$inferInsert;
export type UpstreamKeyCounterRow = typeof upstreamKeyCounters.$inferSelect;
export type UpstreamKeyCounterInsert = typeof upstreamKeyCounters.$inferInsert;
export type UpstreamEndpointHealthRow = typeof upstreamEndpointHealth.$inferSelect;
export type UpstreamEndpointHealthInsert = typeof upstreamEndpointHealth.$inferInsert;
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
export type StickyBindingRow = typeof stickyBindings.$inferSelect;
export type StickyBindingInsert = typeof stickyBindings.$inferInsert;
export type StickySessionRow = typeof stickySessions.$inferSelect;
export type StickySessionInsert = typeof stickySessions.$inferInsert;
export type CircuitBreakerRow = typeof circuitBreakers.$inferSelect;
export type CircuitBreakerInsert = typeof circuitBreakers.$inferInsert;
export type UsageRecordRow = typeof usageRecords.$inferSelect;
export type UsageRecordInsert = typeof usageRecords.$inferInsert;
export type RequestTraceLogRow = typeof requestTraceLogs.$inferSelect;
export type RequestTraceLogInsert = typeof requestTraceLogs.$inferInsert;
export type DebugContentLogRow = typeof debugContentLogs.$inferSelect;
export type DebugContentLogInsert = typeof debugContentLogs.$inferInsert;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type AuditEventInsert = typeof auditEvents.$inferInsert;
export type DailyConsumptionStatRow = typeof dailyConsumptionStats.$inferSelect;
export type DailyConsumptionStatInsert = typeof dailyConsumptionStats.$inferInsert;
export type ModelReferenceEntryRow = typeof modelReferenceEntries.$inferSelect;
export type ModelReferenceEntryInsert = typeof modelReferenceEntries.$inferInsert;
export type ModelReferenceSyncStatusRow = typeof modelReferenceSyncStatus.$inferSelect;
export type ModelReferenceSyncStatusInsert = typeof modelReferenceSyncStatus.$inferInsert;
export type PricingEntryRow = typeof pricingEntries.$inferSelect;
export type PricingEntryInsert = typeof pricingEntries.$inferInsert;
export type PlanRow = typeof plans.$inferSelect;
export type PlanInsert = typeof plans.$inferInsert;
export type BackupRow = typeof backups.$inferSelect;
export type BackupInsert = typeof backups.$inferInsert;
export type AdminSettingsRow = typeof adminSettings.$inferSelect;
export type AdminSettingsInsert = typeof adminSettings.$inferInsert;
export type SchemaMigrationRow = typeof schemaMigrations.$inferSelect;
export type SchemaMigrationInsert = typeof schemaMigrations.$inferInsert;

// 为方便上层使用，重新导出 SourceProtocol。
export type { SourceProtocol };
