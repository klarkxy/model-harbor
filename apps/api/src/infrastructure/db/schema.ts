import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { ProviderType, SourceProtocol } from '@manageyourllm/shared';

// 目标类型：Model 或 Channel，共享同一个命名空间。
// Phase 3 Slice 1：v1 概念统一后，`public_model` / `model_group` 旧值已彻底弃用。
export const TARGET_TYPES = ['model', 'channel'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

// Provider 类型与认证类型，与共享包保持一致。
export const PROVIDER_TYPES = [
  'anthropic_compatible',
  'openai_compatible',
  'coze',
  'codex',
  'deepseek',
  'moonshot',
  'moonshot_cn',
  'minimax',
  'minimax_cn',
  'openrouter',
  'groq',
  'fireworks',
  'together',
  'opencode_go',
  'opencode_zen',
] as const satisfies readonly ProviderType[];

export const UPSTREAM_AUTH_TYPES = ['pat', 'oauth'] as const;
export type UpstreamAuthType = (typeof UPSTREAM_AUTH_TYPES)[number];
// Phase 2 Slice 1：v1 概念统一后，Provider Account 的认证类型语义就是
// ProviderAuthType。Phase 10 一起把 schema enum 改名。
export type ProviderAuthType = UpstreamAuthType;

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
  contentLogExpiresAt: integer('content_log_expires_at', { mode: 'timestamp_ms' }),
  contentLogMaxRows: integer('content_log_max_rows').notNull().default(1000),
  contentLogRetentionDays: integer('content_log_retention_days').notNull().default(7),
  contentLogMaxPayloadBytes: integer('content_log_max_payload_bytes').notNull().default(100_000),
  publicBaseUrl: text('public_base_url'),
  defaultRequestTimeoutMs: integer('default_request_timeout_ms').default(30_000),
  defaultRetries: integer('default_retries').default(0),
  enableStickySession: integer('enable_sticky_session', { mode: 'boolean' }).default(true),
  enableCircuitBreaker: integer('enable_circuit_breaker', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- 客户端 (v1 概念：Client) ---

export const clients = sqliteTable('clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const clientKeys = sqliteTable(
  'client_keys',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
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
  (t) => [index('client_keys_client_idx').on(t.clientId)],
);

// --- Provider Account (v1 概念：上游客账号边界) ---
// Phase 1 Slice 4 数据模型迁移：
// --- Provider Account (v1 概念：上游客账号边界) ---
// Phase 2 Slice 2 重构：
// - 删 `endpoints_json` 列（endpoint 拆出独立表）。
// - 删 `last_health_status` / `last_error_code` / `last_error_message` 列（health 按 endpoint 表达）。
// - quota / counter 表名 + 列名一律改成 `provider_account_*`（不再保留 `upstream_key_*` alias）。
// - SQLite 表名 `upstream_keys` / `upstream_key_quotas` / `upstream_key_counters` /
//   `upstream_endpoint_health` 由 v9 migration 一次性重命名为 `provider_accounts` /
//   `provider_account_quotas` / `provider_account_counters` / `endpoint_health`。

export const providerAccounts = sqliteTable('provider_accounts', {
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
  displayOrder: integer('display_order').notNull().default(1000),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  frozen: integer('frozen', { mode: 'boolean' }).notNull().default(false),
  frozenReason: text('frozen_reason'),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  stickySessionTtlMs: integer('sticky_session_ttl_ms')
    .notNull()
    .default(5 * 60 * 1000),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const providerAccountQuotas = sqliteTable(
  'provider_account_quotas',
  {
    id: text('id').primaryKey(),
    providerAccountId: text('provider_account_id')
      .notNull()
      .unique()
      .references(() => providerAccounts.id, { onDelete: 'cascade' }),
    period: text('period', { enum: QUOTA_PERIODS }).notNull(),
    requestLimit: integer('request_limit'),
    inputTokenLimit: integer('input_token_limit'),
    outputTokenLimit: integer('output_token_limit'),
    totalTokenLimit: integer('total_token_limit'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('provider_account_quotas_account_idx').on(t.providerAccountId)],
);

export const providerAccountCounters = sqliteTable(
  'provider_account_counters',
  {
    id: text('id').primaryKey(),
    providerAccountId: text('provider_account_id')
      .notNull()
      .references(() => providerAccounts.id, { onDelete: 'cascade' }),
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
    uniqueIndex('provider_account_counter_window').on(
      t.providerAccountId,
      t.period,
      t.periodStartedAt,
    ),
    index('provider_account_counter_account_idx').on(t.providerAccountId),
  ],
);

export const endpointHealth = sqliteTable(
  'endpoint_health',
  {
    id: text('id').primaryKey(),
    endpointId: text('endpoint_id')
      .notNull()
      .unique()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    delayMs: integer('delay_ms'),
    lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }),
    degraded: integer('degraded', { mode: 'boolean' }).notNull().default(false),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('endpoint_health_unique').on(t.endpointId),
    index('endpoint_health_degraded_idx').on(t.degraded, t.delayMs),
    index('endpoint_health_checked_idx').on(t.lastCheckedAt),
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

// --- Model (v1 概念：客户端可请求的具体模型名) ---
// Phase 3 Slice 1：物理表已由 `public_models` 重命名为 `models`（v10 migration）。
// 旧符号 `publicModels` / `PublicModelRow` 等一律删除，不留 alias 兼容。

export const models = sqliteTable('models', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name'),
  description: text('description'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const modelCandidates = sqliteTable(
  'model_candidates',
  {
    id: text('id').primaryKey(),
    // Phase 3 Slice 1：列名 `public_model_id` → `model_id`（v10 migration）。
    modelId: text('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'cascade' }),
    providerAccountId: text('provider_account_id')
      .notNull()
      .references(() => providerAccounts.id, { onDelete: 'cascade' }),
    // Phase 3 收口 + Phase 4：v1 candidate 严格绑定 endpoint（1 candidate = 1 endpoint）。
    // 存量 v10 数据走 v11 migration 回填 endpointId（按 account 查 endpoints 行做 N 行拆解）。
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    realModelName: text('real_model_name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    priority: integer('priority').notNull().default(100),
    // Phase 3 Slice 1：`weight` 字段删除（v10 migration DROP COLUMN）。
    // v1 ordering 只靠 `priority`，不再做 weighted / round-robin。
    pingLatencyMs: integer('ping_latency_ms'),
    pingStatus: text('ping_status'),
    // v1 candidate 已通过 endpointId 锁定协议/URL/能力；
    // endpointUrl 列保留为 nullable 覆盖（用户可显式 override），Phase 10 删除。
    endpointUrl: text('endpoint_url'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('model_candidate_unique').on(t.modelId, t.endpointId, t.realModelName),
    index('model_candidate_provider_account_idx').on(t.providerAccountId),
    index('model_candidate_endpoint_idx').on(t.endpointId),
  ],
);

// --- Channel (v1 概念：客户端可请求的用途频道) ---
// Phase 3 Slice 1：物理表已由 `model_groups` 重命名为 `channels`（v10 migration）。
// 旧 `routingPolicy` / `roundRobinCounter` / `mode` / `auto_*` / `weight` 字段一律删除。

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name'),
  description: text('description'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const channelMembers = sqliteTable(
  'channel_members',
  {
    id: text('id').primaryKey(),
    // Phase 3 Slice 1：列名 `model_group_id` → `channel_id`，`public_model_id` → `model_id`。
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    modelId: text('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    priority: integer('priority').notNull().default(100),
    // Phase 3 Slice 1：`weight` 字段删除（v10 migration DROP COLUMN）。
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('channel_member_unique').on(t.channelId, t.modelId)],
);

// --- 路由状态 ---

export const stickyBindings = sqliteTable(
  'sticky_bindings',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    clientKeyId: text('client_key_id')
      .notNull()
      .references(() => clientKeys.id, { onDelete: 'cascade' }),
    requestedTargetName: text('requested_target_name').notNull(),
    conversationFingerprint: text('conversation_fingerprint').notNull(),
    // Phase 2 Slice 2：列名 upstream_key_id → provider_account_id。
    providerAccountId: text('provider_account_id')
      .notNull()
      .references(() => providerAccounts.id, { onDelete: 'cascade' }),
    realModelName: text('real_model_name').notNull(),
    // Phase 3 收口 + Phase 4：sticky 改用 endpointId FK 匹配。
    // endpointUrl 保留为 nullable 兼容列（Phase 10 删）。
    endpointId: text('endpoint_id').references(() => endpoints.id, { onDelete: 'cascade' }),
    endpointUrl: text('endpoint_url'),
    hitCount: integer('hit_count').notNull().default(0),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('sticky_binding_unique').on(
      t.clientId,
      t.clientKeyId,
      t.requestedTargetName,
      t.conversationFingerprint,
    ),
    index('sticky_binding_client_key_idx').on(t.clientKeyId, t.requestedTargetName),
    index('sticky_binding_endpoint_idx').on(t.endpointId),
    index('sticky_binding_expires_idx').on(t.expiresAt),
  ],
);

export const stickySessions = sqliteTable(
  'sticky_sessions',
  {
    id: text('id').primaryKey(),
    clientKeyId: text('client_key_id')
      .notNull()
      .references(() => clientKeys.id, { onDelete: 'cascade' }),
    requestedTargetName: text('requested_target_name').notNull(),
    providerAccountId: text('provider_account_id')
      .notNull()
      .references(() => providerAccounts.id, { onDelete: 'cascade' }),
    realModelName: text('real_model_name').notNull(),
    // Phase 3 收口 + Phase 4：sticky 改用 endpointId FK 匹配。
    endpointId: text('endpoint_id').references(() => endpoints.id, { onDelete: 'cascade' }),
    endpointUrl: text('endpoint_url'),
    ttlMs: integer('ttl_ms').notNull(),
    hitCount: integer('hit_count').notNull().default(0),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('sticky_session_unique').on(t.clientKeyId, t.requestedTargetName),
    index('sticky_session_client_key_idx').on(t.clientKeyId, t.requestedTargetName),
    index('sticky_session_expires_idx').on(t.expiresAt),
  ],
);

export const circuitBreakers = sqliteTable(
  'circuit_breakers',
  {
    id: text('id').primaryKey(),
    providerAccountId: text('provider_account_id')
      .notNull()
      .references(() => providerAccounts.id, { onDelete: 'cascade' }),
    // Phase 3 收口 + Phase 4：breaker 状态键从 (account_id, model) 改为
    // (account_id, endpoint_id, model)，与 candidate endpointId 化对齐。
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    realModelName: text('real_model_name').notNull(),
    state: text('state', { enum: ['closed', 'open', 'half_open'] as const })
      .notNull()
      .default('closed'),
    failureCount: integer('failure_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    openCount: integer('open_count').notNull().default(0),
    openedAt: integer('opened_at', { mode: 'timestamp_ms' }),
    cooldownUntil: integer('cooldown_until', { mode: 'timestamp_ms' }),
    // LiteLLM 借鉴：per-candidate cooldown 失败率窗口计数。
    cooldownFailureCount: integer('cooldown_failure_count').notNull().default(0),
    cooldownFailureWindowStart: integer('cooldown_failure_window_start', { mode: 'timestamp_ms' }),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('circuit_breaker_unique').on(t.providerAccountId, t.endpointId, t.realModelName),
    index('circuit_breaker_endpoint_idx').on(t.endpointId),
    index('circuit_breaker_state_idx').on(t.state, t.cooldownUntil),
    index('circuit_breaker_updated_idx').on(t.updatedAt),
  ],
);

// --- 可观测性 ---

export const usageRecords = sqliteTable(
  'usage_records',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    clientKeyId: text('client_key_id')
      .notNull()
      .references(() => clientKeys.id, { onDelete: 'cascade' }),
    requestedTargetName: text('requested_target_name').notNull(),
    resolvedTargetType: text('resolved_target_type', { enum: TARGET_TYPES }).notNull(),
    resolvedTargetId: text('resolved_target_id').notNull(),
    requestTraceId: text('request_trace_id'),
    // Phase 2 Slice 2：upstream_key_id → provider_account_id（v9 migration rename）。
    providerAccountId: text('provider_account_id')
      .notNull()
      .references(() => providerAccounts.id, { onDelete: 'cascade' }),
    // Phase 9 收口：记录最终命中的 endpoint，与 circuit_breakers / sticky_* 对齐
    // per-candidate 粒度。nullable 是因为历史行在 v15 之前没有该列，无法回填。
    endpointId: text('endpoint_id').references(() => endpoints.id, { onDelete: 'set null' }),
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
    index('usage_records_client_idx').on(t.clientId, t.createdAt),
    index('usage_records_client_key_idx').on(t.clientKeyId, t.createdAt),
    index('usage_records_provider_account_idx').on(t.providerAccountId, t.createdAt),
    index('usage_records_trace_idx').on(t.requestTraceId),
    index('usage_records_endpoint_idx').on(t.endpointId, t.createdAt),
  ],
);

export const requestTraceLogs = sqliteTable(
  'request_trace_logs',
  {
    id: text('id').primaryKey(),
    requestTraceId: text('request_trace_id').notNull(),
    step: text('step').notNull(),
    stepIndex: integer('step_index').notNull(),
    clientId: text('client_id'),
    clientKeyId: text('client_key_id'),
    requestedTargetName: text('requested_target_name'),
    providerAccountId: text('provider_account_id'),
    // 收口 #12：trace event 按 endpoint 维度可筛选
    endpointId: text('endpoint_id').references(() => endpoints.id, { onDelete: 'set null' }),
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
    index('request_trace_logs_client_key_idx').on(t.clientKeyId, t.createdAt),
    index('request_trace_logs_provider_account_idx').on(t.providerAccountId, t.createdAt),
    index('request_trace_logs_endpoint_idx').on(t.endpointId, t.createdAt),
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
    providerAccountId: text('provider_account_id').notNull(),
    // v18 收口：endpoint_id 加入 UNIQUE 防止同 provider/model/day 下多 endpoint 碰撞。
    // 历史行无 endpoint_id 仍保持 NULL（SQLite NULL != NULL，多个 NULL 可共存）。
    endpointId: text('endpoint_id').references(() => endpoints.id, { onDelete: 'set null' }),
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
    uniqueIndex('daily_consumption_stats_unique').on(
      t.providerAccountId,
      t.endpointId,
      t.realModelName,
      t.dayDate,
    ),
    index('daily_consumption_stats_day_idx').on(t.dayDate),
    index('daily_consumption_stats_provider_account_idx').on(t.providerAccountId, t.dayDate),
  ],
);

// --- 模型参考 ---

export const MODEL_REFERENCE_REGIONS = ['global'] as const;
export type ModelReferenceRegion = (typeof MODEL_REFERENCE_REGIONS)[number];

export const MODEL_REFERENCE_SOURCES = ['arena'] as const;
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
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
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
    providerAccountId: text('provider_account_id').references(() => providerAccounts.id, {
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
    index('pricing_entries_provider_account_idx').on(t.providerAccountId, t.realModelName),
  ],
);

export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    planType: text('plan_type', { enum: PLAN_TYPES }).notNull(),
    name: text('name').notNull(),
    providerType: text('provider_type', { enum: PROVIDER_TYPES }),
    providerAccountId: text('provider_account_id').references(() => providerAccounts.id, {
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
    index('plans_provider_account_idx').on(t.providerAccountId),
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
export type ClientRow = typeof clients.$inferSelect;
export type ClientInsert = typeof clients.$inferInsert;
export type ClientKeyRow = typeof clientKeys.$inferSelect;
export type ClientKeyInsert = typeof clientKeys.$inferInsert;
export type ProviderAccountRow = typeof providerAccounts.$inferSelect;
export type ProviderAccountInsert = typeof providerAccounts.$inferInsert;
export type ProviderAccountQuotaRow = typeof providerAccountQuotas.$inferSelect;
export type ProviderAccountQuotaInsert = typeof providerAccountQuotas.$inferInsert;
export type ProviderAccountCounterRow = typeof providerAccountCounters.$inferSelect;
export type ProviderAccountCounterInsert = typeof providerAccountCounters.$inferInsert;
export type EndpointHealthRow = typeof endpointHealth.$inferSelect;
export type EndpointHealthInsert = typeof endpointHealth.$inferInsert;

// --- Endpoint (v1 概念：协议、健康、能力、路由边界的一等对象) ---
// Phase 2 Slice 2：endpoint 是独立表。物理表名 `endpoints`，FK to provider_accounts。
// 路由（routing-decision）/ 探测（probe）/ 健康（health）一律读本表，不再读 JSON 列。

export const endpoints = sqliteTable(
  'endpoints',
  {
    id: text('id').primaryKey(),
    providerAccountId: text('provider_account_id')
      .notNull()
      .references(() => providerAccounts.id, { onDelete: 'cascade' }),
    protocol: text('protocol').notNull(),
    baseUrl: text('base_url').notNull(),
    path: text('path'),
    providerType: text('provider_type', { enum: PROVIDER_TYPES }).notNull(),
    defaultHeadersJson: text('default_headers_json', { mode: 'json' }).$type<
      Record<string, string>
    >(),
    extraHeadersJson: text('extra_headers_json', { mode: 'json' }).$type<Record<string, string>>(),
    extraParamsJson: text('extra_params_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    capabilitiesJson: text('capabilities_json', { mode: 'json' })
      .$type<unknown[]>()
      .notNull()
      .default([]),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    displayOrder: integer('display_order').notNull().default(1000),
    isPresetDefault: integer('is_preset_default', { mode: 'boolean' }).notNull().default(false),
    source: text('source', { enum: ['user', 'preset'] as const })
      .notNull()
      .default('user'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('endpoints_account_idx').on(t.providerAccountId, t.displayOrder),
    uniqueIndex('endpoints_account_baseurl_unique').on(t.providerAccountId, t.baseUrl),
  ],
);

export type EndpointRow = typeof endpoints.$inferSelect;
export type EndpointInsert = typeof endpoints.$inferInsert;
export type TargetNameRow = typeof targetNames.$inferSelect;
export type TargetNameInsert = typeof targetNames.$inferInsert;
export type ModelRow = typeof models.$inferSelect;
export type ModelInsert = typeof models.$inferInsert;
export type ModelCandidateRow = typeof modelCandidates.$inferSelect;
export type ModelCandidateInsert = typeof modelCandidates.$inferInsert;
export type ChannelRow = typeof channels.$inferSelect;
export type ChannelInsert = typeof channels.$inferInsert;
export type ChannelMemberRow = typeof channelMembers.$inferSelect;
export type ChannelMemberInsert = typeof channelMembers.$inferInsert;
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
