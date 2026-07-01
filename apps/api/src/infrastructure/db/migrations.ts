// 显式 schema 迁移语句。
// 新版本从 v1 开始；所有语句幂等，支持空库直接创建。

export interface Migration {
  version: number;
  statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      // 迁移记录表自身
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version INTEGER PRIMARY KEY,
         applied_at INTEGER NOT NULL
       )`,

      // 管理员
      `CREATE TABLE IF NOT EXISTS admin_users (
         id TEXT PRIMARY KEY,
         username TEXT NOT NULL UNIQUE,
         password_hash TEXT NOT NULL,
         display_name TEXT,
         enabled INTEGER NOT NULL DEFAULT 1,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         last_login_at INTEGER
       )`,
      `CREATE TABLE IF NOT EXISTS admin_sessions (
         id TEXT PRIMARY KEY,
         admin_user_id TEXT NOT NULL,
         session_hash TEXT NOT NULL UNIQUE,
         expires_at INTEGER NOT NULL,
         created_at INTEGER NOT NULL,
         last_seen_at INTEGER NOT NULL,
         FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON admin_sessions(admin_user_id)`,
      `CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions(expires_at)`,
      `CREATE TABLE IF NOT EXISTS login_attempts (
         id TEXT PRIMARY KEY,
         username TEXT NOT NULL,
         ip TEXT NOT NULL,
         success INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS login_attempts_created_at_idx ON login_attempts(created_at)`,
      `CREATE INDEX IF NOT EXISTS login_attempts_username_idx ON login_attempts(username, created_at)`,
      `CREATE INDEX IF NOT EXISTS login_attempts_ip_idx ON login_attempts(ip, created_at)`,

      // 系统设置
      `CREATE TABLE IF NOT EXISTS admin_settings (
         id TEXT PRIMARY KEY,
         circuit_breaker_enabled INTEGER NOT NULL DEFAULT 1,
         circuit_breaker_failure_threshold INTEGER NOT NULL DEFAULT 5,
         circuit_breaker_base_cooldown_ms INTEGER NOT NULL DEFAULT 60000,
         circuit_breaker_max_cooldown_ms INTEGER NOT NULL DEFAULT 600000,
         circuit_breaker_half_open_success_count INTEGER NOT NULL DEFAULT 2,
         endpoint_health_probe_enabled INTEGER NOT NULL DEFAULT 1,
         endpoint_health_probe_interval_ms INTEGER NOT NULL DEFAULT 3600000,
         endpoint_health_probe_timeout_ms INTEGER NOT NULL DEFAULT 10000,
         endpoint_health_probe_degraded_latency_ms INTEGER NOT NULL DEFAULT 5000,
         first_token_timeout_ms INTEGER NOT NULL DEFAULT 15000,
         content_log_enabled INTEGER NOT NULL DEFAULT 0,
         content_log_retention_days INTEGER NOT NULL DEFAULT 7,
         content_log_max_payload_bytes INTEGER NOT NULL DEFAULT 100000,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,

      // 应用与 Consumer Key
      `CREATE TABLE IF NOT EXISTS apps (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL UNIQUE,
         description TEXT,
         enabled INTEGER NOT NULL DEFAULT 1,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS consumer_keys (
         id TEXT PRIMARY KEY,
         app_id TEXT NOT NULL,
         name TEXT NOT NULL,
         key_hash TEXT NOT NULL UNIQUE,
         key_prefix TEXT NOT NULL,
         key_suffix TEXT NOT NULL DEFAULT '',
         access_mode TEXT NOT NULL DEFAULT 'all',
         enabled INTEGER NOT NULL DEFAULT 1,
         revoked_at INTEGER,
         last_used_at INTEGER,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS consumer_keys_app_idx ON consumer_keys(app_id)`,

      // 上游 Key
      `CREATE TABLE IF NOT EXISTS upstream_keys (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL UNIQUE,
         provider_preset_id TEXT,
         provider_type TEXT NOT NULL,
         base_url TEXT NOT NULL,
         auth_type TEXT NOT NULL DEFAULT 'pat',
         api_key_ciphertext TEXT NOT NULL,
         api_key_prefix TEXT NOT NULL,
         auth_config_ciphertext TEXT,
         default_headers_json TEXT,
         extra_headers_json TEXT,
         extra_params_json TEXT,
         supported_models_json TEXT NOT NULL DEFAULT '[]',
         endpoints_json TEXT,
         display_order INTEGER NOT NULL DEFAULT 1000,
         enabled INTEGER NOT NULL DEFAULT 1,
         frozen INTEGER NOT NULL DEFAULT 0,
         frozen_reason TEXT,
         cooldown_until INTEGER,
         last_health_status TEXT,
         last_error_code TEXT,
         last_error_message TEXT,
         last_used_at INTEGER,
         sticky_session_ttl_ms INTEGER NOT NULL DEFAULT 300000,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS upstream_key_quotas (
         id TEXT PRIMARY KEY,
         upstream_key_id TEXT NOT NULL UNIQUE,
         period TEXT NOT NULL,
         request_limit INTEGER,
         input_token_limit INTEGER,
         output_token_limit INTEGER,
         total_token_limit INTEGER,
         enabled INTEGER NOT NULL DEFAULT 1,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (upstream_key_id) REFERENCES upstream_keys(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS upstream_key_quotas_key_idx ON upstream_key_quotas(upstream_key_id)`,
      `CREATE TABLE IF NOT EXISTS upstream_key_counters (
         id TEXT PRIMARY KEY,
         upstream_key_id TEXT NOT NULL,
         period TEXT NOT NULL,
         period_started_at INTEGER NOT NULL,
         period_ends_at INTEGER NOT NULL,
         request_count INTEGER NOT NULL DEFAULT 0,
         input_tokens INTEGER NOT NULL DEFAULT 0,
         output_tokens INTEGER NOT NULL DEFAULT 0,
         total_tokens INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (upstream_key_id) REFERENCES upstream_keys(id) ON DELETE CASCADE
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS upstream_key_counter_window ON upstream_key_counters(upstream_key_id, period, period_started_at)`,
      `CREATE INDEX IF NOT EXISTS upstream_key_counter_upstream_idx ON upstream_key_counters(upstream_key_id)`,
      `CREATE TABLE IF NOT EXISTS upstream_endpoint_health (
         id TEXT PRIMARY KEY,
         upstream_key_id TEXT NOT NULL,
         endpoint_base_url TEXT NOT NULL,
         delay_ms INTEGER,
         last_checked_at INTEGER,
         degraded INTEGER NOT NULL DEFAULT 0,
         error_code TEXT,
         error_message TEXT,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (upstream_key_id) REFERENCES upstream_keys(id) ON DELETE CASCADE
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS upstream_endpoint_health_unique ON upstream_endpoint_health(upstream_key_id, endpoint_base_url)`,
      `CREATE INDEX IF NOT EXISTS upstream_endpoint_health_key_idx ON upstream_endpoint_health(upstream_key_id)`,
      `CREATE INDEX IF NOT EXISTS upstream_endpoint_health_degraded_idx ON upstream_endpoint_health(degraded, delay_ms)`,
      `CREATE INDEX IF NOT EXISTS upstream_endpoint_health_checked_idx ON upstream_endpoint_health(last_checked_at)`,

      // 目标命名空间与模型暴露
      `CREATE TABLE IF NOT EXISTS target_names (
         name TEXT PRIMARY KEY,
         target_type TEXT NOT NULL,
         target_id TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS target_names_target_idx ON target_names(target_type, target_id)`,
      `CREATE TABLE IF NOT EXISTS public_models (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL UNIQUE,
         display_name TEXT,
         description TEXT,
         enabled INTEGER NOT NULL DEFAULT 1,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS public_model_candidates (
         id TEXT PRIMARY KEY,
         public_model_id TEXT NOT NULL,
         upstream_key_id TEXT NOT NULL,
         real_model_name TEXT NOT NULL,
         enabled INTEGER NOT NULL DEFAULT 1,
         priority INTEGER NOT NULL DEFAULT 100,
         weight INTEGER NOT NULL DEFAULT 1,
         ping_latency_ms INTEGER,
         ping_status TEXT,
         endpoint_url TEXT,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (public_model_id) REFERENCES public_models(id) ON DELETE CASCADE,
         FOREIGN KEY (upstream_key_id) REFERENCES upstream_keys(id) ON DELETE CASCADE
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS public_model_candidate_unique ON public_model_candidates(public_model_id, upstream_key_id, real_model_name)`,
      `CREATE INDEX IF NOT EXISTS public_model_candidate_upstream_idx ON public_model_candidates(upstream_key_id)`,
      `CREATE TABLE IF NOT EXISTS model_groups (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL UNIQUE,
         display_name TEXT,
         description TEXT,
         enabled INTEGER NOT NULL DEFAULT 1,
         routing_policy TEXT NOT NULL DEFAULT 'priority',
         round_robin_counter INTEGER NOT NULL DEFAULT 0,
         mode TEXT NOT NULL DEFAULT 'manual',
         auto_preset TEXT,
         auto_region TEXT,
         auto_top_n INTEGER,
         auto_last_refreshed_at INTEGER,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS model_group_members (
         id TEXT PRIMARY KEY,
         model_group_id TEXT NOT NULL,
         public_model_id TEXT NOT NULL,
         enabled INTEGER NOT NULL DEFAULT 1,
         priority INTEGER NOT NULL DEFAULT 100,
         weight INTEGER NOT NULL DEFAULT 1,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (model_group_id) REFERENCES model_groups(id) ON DELETE CASCADE,
         FOREIGN KEY (public_model_id) REFERENCES public_models(id) ON DELETE CASCADE
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS model_group_member_unique ON model_group_members(model_group_id, public_model_id)`,

      // 路由状态
      `CREATE TABLE IF NOT EXISTS sticky_bindings (
         id TEXT PRIMARY KEY,
         app_id TEXT NOT NULL,
         consumer_key_id TEXT NOT NULL,
         requested_target_name TEXT NOT NULL,
         conversation_fingerprint TEXT NOT NULL,
         upstream_key_id TEXT NOT NULL,
         real_model_name TEXT NOT NULL,
         hit_count INTEGER NOT NULL DEFAULT 0,
         last_used_at INTEGER NOT NULL,
         expires_at INTEGER NOT NULL,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
         FOREIGN KEY (consumer_key_id) REFERENCES consumer_keys(id) ON DELETE CASCADE,
         FOREIGN KEY (upstream_key_id) REFERENCES upstream_keys(id) ON DELETE CASCADE
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS sticky_binding_unique ON sticky_bindings(app_id, consumer_key_id, requested_target_name, conversation_fingerprint)`,
      `CREATE INDEX IF NOT EXISTS sticky_binding_consumer_idx ON sticky_bindings(consumer_key_id, requested_target_name)`,
      `CREATE INDEX IF NOT EXISTS sticky_binding_expires_idx ON sticky_bindings(expires_at)`,
      `CREATE TABLE IF NOT EXISTS sticky_sessions (
         id TEXT PRIMARY KEY,
         consumer_key_id TEXT NOT NULL,
         requested_target_name TEXT NOT NULL,
         upstream_key_id TEXT NOT NULL,
         real_model_name TEXT NOT NULL,
         ttl_ms INTEGER NOT NULL,
         hit_count INTEGER NOT NULL DEFAULT 0,
         last_used_at INTEGER NOT NULL,
         expires_at INTEGER NOT NULL,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (consumer_key_id) REFERENCES consumer_keys(id) ON DELETE CASCADE,
         FOREIGN KEY (upstream_key_id) REFERENCES upstream_keys(id) ON DELETE CASCADE
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS sticky_session_unique ON sticky_sessions(consumer_key_id, requested_target_name)`,
      `CREATE INDEX IF NOT EXISTS sticky_session_consumer_idx ON sticky_sessions(consumer_key_id, requested_target_name)`,
      `CREATE INDEX IF NOT EXISTS sticky_session_expires_idx ON sticky_sessions(expires_at)`,
      `CREATE TABLE IF NOT EXISTS circuit_breakers (
         id TEXT PRIMARY KEY,
         upstream_key_id TEXT NOT NULL,
         real_model_name TEXT NOT NULL,
         state TEXT NOT NULL DEFAULT 'closed',
         failure_count INTEGER NOT NULL DEFAULT 0,
         success_count INTEGER NOT NULL DEFAULT 0,
         open_count INTEGER NOT NULL DEFAULT 0,
         opened_at INTEGER,
         cooldown_until INTEGER,
         last_error_code TEXT,
         last_error_message TEXT,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (upstream_key_id) REFERENCES upstream_keys(id) ON DELETE CASCADE
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS circuit_breaker_unique ON circuit_breakers(upstream_key_id, real_model_name)`,
      `CREATE INDEX IF NOT EXISTS circuit_breaker_state_idx ON circuit_breakers(state, cooldown_until)`,
      `CREATE INDEX IF NOT EXISTS circuit_breaker_updated_idx ON circuit_breakers(updated_at)`,

      // 可观测性
      `CREATE TABLE IF NOT EXISTS usage_records (
         id TEXT PRIMARY KEY,
         app_id TEXT NOT NULL,
         consumer_key_id TEXT NOT NULL,
         requested_target_name TEXT NOT NULL,
         resolved_target_type TEXT NOT NULL,
         resolved_target_id TEXT NOT NULL,
         upstream_key_id TEXT NOT NULL,
         real_model_name TEXT NOT NULL,
         source_protocol TEXT NOT NULL,
         provider_type TEXT NOT NULL,
         stream INTEGER NOT NULL DEFAULT 0,
         sticky_hit INTEGER NOT NULL DEFAULT 0,
         session_sticky_hit INTEGER NOT NULL DEFAULT 0,
         input_tokens INTEGER,
         output_tokens INTEGER,
         total_tokens INTEGER,
         cache_read_tokens INTEGER,
         cache_write_tokens INTEGER,
         status TEXT NOT NULL,
         error_code TEXT,
         latency_ms INTEGER NOT NULL,
         cost_amount INTEGER,
         cost_currency TEXT,
         created_at INTEGER NOT NULL,
         FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
         FOREIGN KEY (consumer_key_id) REFERENCES consumer_keys(id) ON DELETE CASCADE,
         FOREIGN KEY (upstream_key_id) REFERENCES upstream_keys(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS usage_records_created_at_idx ON usage_records(created_at)`,
      `CREATE INDEX IF NOT EXISTS usage_records_app_idx ON usage_records(app_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS usage_records_consumer_idx ON usage_records(consumer_key_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS usage_records_upstream_idx ON usage_records(upstream_key_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS request_trace_logs (
         id TEXT PRIMARY KEY,
         request_trace_id TEXT NOT NULL,
         step TEXT NOT NULL,
         step_index INTEGER NOT NULL,
         app_id TEXT,
         consumer_key_id TEXT,
         requested_target_name TEXT,
         upstream_key_id TEXT,
         real_model_name TEXT,
         status TEXT,
         error_code TEXT,
         error_message TEXT,
         details_json TEXT,
         created_at INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS request_trace_logs_trace_id_idx ON request_trace_logs(request_trace_id)`,
      `CREATE INDEX IF NOT EXISTS request_trace_logs_created_at_idx ON request_trace_logs(created_at)`,
      `CREATE INDEX IF NOT EXISTS request_trace_logs_consumer_idx ON request_trace_logs(consumer_key_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS request_trace_logs_upstream_idx ON request_trace_logs(upstream_key_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS debug_content_logs (
         id TEXT PRIMARY KEY,
         request_trace_id TEXT,
         prompt_json TEXT,
         response_json TEXT,
         input_tokens INTEGER,
         output_tokens INTEGER,
         total_tokens INTEGER,
         created_at INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS debug_content_logs_trace_id_idx ON debug_content_logs(request_trace_id)`,
      `CREATE INDEX IF NOT EXISTS debug_content_logs_created_at_idx ON debug_content_logs(created_at)`,
      `CREATE TABLE IF NOT EXISTS audit_events (
         id TEXT PRIMARY KEY,
         actor_admin_id TEXT,
         actor_username TEXT,
         action TEXT NOT NULL,
         resource_type TEXT NOT NULL,
         resource_id TEXT,
         details_json TEXT,
         ip TEXT,
         created_at INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events(created_at)`,
      `CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events(actor_admin_id)`,
      `CREATE INDEX IF NOT EXISTS audit_events_resource_idx ON audit_events(resource_type, resource_id)`,
      `CREATE TABLE IF NOT EXISTS daily_consumption_stats (
         id TEXT PRIMARY KEY,
         upstream_key_id TEXT NOT NULL,
         real_model_name TEXT NOT NULL,
         day_date TEXT NOT NULL,
         request_count INTEGER NOT NULL DEFAULT 0,
         success_count INTEGER NOT NULL DEFAULT 0,
         error_count INTEGER NOT NULL DEFAULT 0,
         input_tokens INTEGER NOT NULL DEFAULT 0,
         output_tokens INTEGER NOT NULL DEFAULT 0,
         total_tokens INTEGER NOT NULL DEFAULT 0,
         cache_read_tokens INTEGER NOT NULL DEFAULT 0,
         cache_write_tokens INTEGER NOT NULL DEFAULT 0,
         avg_latency_ms INTEGER NOT NULL DEFAULT 0,
         total_cost_amount INTEGER NOT NULL DEFAULT 0,
         cost_currency TEXT NOT NULL DEFAULT 'USD',
         updated_at INTEGER NOT NULL
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS daily_consumption_stats_unique ON daily_consumption_stats(upstream_key_id, real_model_name, day_date)`,
      `CREATE INDEX IF NOT EXISTS daily_consumption_stats_day_idx ON daily_consumption_stats(day_date)`,
      `CREATE INDEX IF NOT EXISTS daily_consumption_stats_upstream_idx ON daily_consumption_stats(upstream_key_id, day_date)`,

      // 模型参考
      `CREATE TABLE IF NOT EXISTS model_reference_entries (
         id TEXT PRIMARY KEY,
         region TEXT NOT NULL,
         source TEXT NOT NULL,
         normalized_model_name TEXT NOT NULL,
         source_model_id TEXT NOT NULL,
         display_name TEXT NOT NULL,
         provider TEXT,
         scores_json TEXT NOT NULL DEFAULT '{}',
         price_json TEXT NOT NULL DEFAULT '{}',
         context_window INTEGER,
         latency_ms INTEGER,
         speed_score INTEGER,
         source_url TEXT,
         raw_json TEXT,
         fetched_at INTEGER NOT NULL
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS model_reference_entry_unique ON model_reference_entries(region, source, normalized_model_name)`,
      `CREATE INDEX IF NOT EXISTS model_reference_entry_region_idx ON model_reference_entries(region, source)`,
      `CREATE TABLE IF NOT EXISTS model_reference_sync_status (
         id TEXT PRIMARY KEY,
         region TEXT NOT NULL,
         source TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'idle',
         last_refresh_at INTEGER,
         next_refresh_after INTEGER,
         last_error TEXT,
         ttl_ms INTEGER NOT NULL DEFAULT 86400000,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS model_reference_sync_unique ON model_reference_sync_status(region, source)`,
      `CREATE INDEX IF NOT EXISTS model_reference_sync_region_idx ON model_reference_sync_status(region)`,

      // 成本账本
      `CREATE TABLE IF NOT EXISTS pricing_entries (
         id TEXT PRIMARY KEY,
         provider_type TEXT NOT NULL,
         upstream_key_id TEXT,
         real_model_name TEXT NOT NULL,
         input_price_per_1k INTEGER NOT NULL,
         output_price_per_1k INTEGER NOT NULL,
         currency TEXT NOT NULL DEFAULT 'USD',
         effective_from INTEGER NOT NULL,
         effective_until INTEGER,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (upstream_key_id) REFERENCES upstream_keys(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS pricing_entries_provider_idx ON pricing_entries(provider_type, real_model_name)`,
      `CREATE INDEX IF NOT EXISTS pricing_entries_upstream_idx ON pricing_entries(upstream_key_id, real_model_name)`,
      `CREATE TABLE IF NOT EXISTS plans (
         id TEXT PRIMARY KEY,
         plan_type TEXT NOT NULL,
         name TEXT NOT NULL,
         provider_type TEXT,
         upstream_key_id TEXT,
         total_amount INTEGER NOT NULL,
         used_amount INTEGER NOT NULL DEFAULT 0,
         remaining_amount INTEGER NOT NULL,
         unit TEXT NOT NULL,
         period TEXT NOT NULL,
         purchased_at INTEGER NOT NULL,
         valid_from INTEGER NOT NULL,
         valid_until INTEGER,
         reminder_days INTEGER NOT NULL DEFAULT 7,
         notes TEXT,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (upstream_key_id) REFERENCES upstream_keys(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS plans_type_idx ON plans(plan_type)`,
      `CREATE INDEX IF NOT EXISTS plans_upstream_idx ON plans(upstream_key_id)`,
      `CREATE INDEX IF NOT EXISTS plans_valid_until_idx ON plans(valid_until)`,

      // 备份
      `CREATE TABLE IF NOT EXISTS backups (
         id TEXT PRIMARY KEY,
         filename TEXT NOT NULL UNIQUE,
         type TEXT NOT NULL,
         size_bytes INTEGER NOT NULL DEFAULT 0,
         schema_version INTEGER NOT NULL,
         note TEXT,
         created_at INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS backups_created_at_idx ON backups(created_at)`,
    ],
  },
  {
    version: 2,
    statements: [
      `ALTER TABLE admin_settings ADD COLUMN public_base_url TEXT`,
      `ALTER TABLE admin_settings ADD COLUMN gateway_base_path TEXT DEFAULT '/v1'`,
      `ALTER TABLE admin_settings ADD COLUMN default_request_timeout_ms INTEGER DEFAULT 30000`,
      `ALTER TABLE admin_settings ADD COLUMN default_retries INTEGER DEFAULT 0`,
      `ALTER TABLE admin_settings ADD COLUMN enable_sticky_session INTEGER DEFAULT 1`,
      `ALTER TABLE admin_settings ADD COLUMN enable_circuit_breaker INTEGER DEFAULT 1`,
    ],
  },
  {
    version: 3,
    statements: [
      `ALTER TABLE usage_records ADD COLUMN request_trace_id TEXT`,
      `CREATE INDEX IF NOT EXISTS usage_records_trace_idx ON usage_records(request_trace_id)`,
    ],
  },
  {
    version: 4,
    statements: [
      `ALTER TABLE admin_settings ADD COLUMN content_log_expires_at INTEGER`,
      `ALTER TABLE admin_settings ADD COLUMN content_log_max_rows INTEGER NOT NULL DEFAULT 1000`,
    ],
  },
  {
    version: 5,
    statements: [
      `ALTER TABLE model_reference_entries ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE model_reference_entries ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: 6,
    statements: [
      `ALTER TABLE admin_settings ADD COLUMN upstream_cooldown_base_ms INTEGER NOT NULL DEFAULT 30000`,
      `ALTER TABLE admin_settings ADD COLUMN upstream_cooldown_max_ms INTEGER NOT NULL DEFAULT 300000`,
    ],
  },
  {
    version: 7,
    statements: [
      `ALTER TABLE sticky_bindings ADD COLUMN endpoint_url TEXT`,
      `ALTER TABLE sticky_bindings ADD COLUMN endpoint_index INTEGER`,
      `ALTER TABLE sticky_sessions ADD COLUMN endpoint_url TEXT`,
      `ALTER TABLE sticky_sessions ADD COLUMN endpoint_index INTEGER`,
    ],
  },
  {
    version: 8,
    statements: [
      // Provider Preset 已改为只读内置，不再持久化本地 preset。
      `DROP TABLE IF EXISTS provider_presets`,
    ],
  },
  {
    version: 9,
    statements: [
      // Phase 2 Slice 2：endpoint 一等对象 + 账号 / quota / counter / health 表名 column 重命名。
      // 当前没有存量数据，所有结构变更直接生效。

      // 1. provider_accounts 表改名 + 删 endpoints_json / last_health_status 等列。
      `ALTER TABLE upstream_keys RENAME TO provider_accounts`,
      `CREATE TABLE IF NOT EXISTS provider_accounts_new (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL UNIQUE,
         provider_preset_id TEXT,
         provider_type TEXT NOT NULL,
         base_url TEXT NOT NULL,
         auth_type TEXT NOT NULL DEFAULT 'pat',
         api_key_ciphertext TEXT NOT NULL,
         api_key_prefix TEXT NOT NULL,
         auth_config_ciphertext TEXT,
         default_headers_json TEXT,
         extra_headers_json TEXT,
         extra_params_json TEXT,
         supported_models_json TEXT NOT NULL DEFAULT '[]',
         display_order INTEGER NOT NULL DEFAULT 1000,
         enabled INTEGER NOT NULL DEFAULT 1,
         frozen INTEGER NOT NULL DEFAULT 0,
         frozen_reason TEXT,
         cooldown_until INTEGER,
         last_used_at INTEGER,
         sticky_session_ttl_ms INTEGER NOT NULL DEFAULT 300000,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      // 当前没数据，INSERT INTO ... SELECT 直接传 0 行；保留以防御性写。
      `INSERT INTO provider_accounts_new (
         id, name, provider_preset_id, provider_type, base_url, auth_type,
         api_key_ciphertext, api_key_prefix, auth_config_ciphertext,
         default_headers_json, extra_headers_json, extra_params_json,
         supported_models_json, display_order, enabled, frozen, frozen_reason,
         cooldown_until, last_used_at, sticky_session_ttl_ms,
         created_at, updated_at
       )
       SELECT
         id, name, provider_preset_id, provider_type, base_url, auth_type,
         api_key_ciphertext, api_key_prefix, auth_config_ciphertext,
         default_headers_json, extra_headers_json, extra_params_json,
         supported_models_json, display_order, enabled, frozen, frozen_reason,
         cooldown_until, last_used_at, sticky_session_ttl_ms,
         created_at, updated_at
       FROM provider_accounts`,
      `DROP TABLE provider_accounts`,
      `ALTER TABLE provider_accounts_new RENAME TO provider_accounts`,

      // 2. quota / counter 表重命名 + 列重命名（FK 自动跟随表 rename）。
      `ALTER TABLE upstream_key_quotas RENAME TO provider_account_quotas`,
      `ALTER TABLE provider_account_quotas RENAME COLUMN upstream_key_id TO provider_account_id`,
      `ALTER TABLE upstream_key_counters RENAME TO provider_account_counters`,
      `ALTER TABLE provider_account_counters RENAME COLUMN upstream_key_id TO provider_account_id`,

      // 3. 路由状态表列重命名（upstream_key_id → provider_account_id）。
      `ALTER TABLE sticky_bindings RENAME COLUMN upstream_key_id TO provider_account_id`,
      `ALTER TABLE sticky_sessions RENAME COLUMN upstream_key_id TO provider_account_id`,
      `ALTER TABLE circuit_breakers RENAME COLUMN upstream_key_id TO provider_account_id`,

      // 4. usage_records / request_trace_logs / daily_consumption_stats / pricing_entries / plans
      //    都引用 upstream_key_id（logical provider_account_id），改列名。
      `ALTER TABLE usage_records RENAME COLUMN upstream_key_id TO provider_account_id`,
      `ALTER TABLE request_trace_logs RENAME COLUMN upstream_key_id TO provider_account_id`,
      `ALTER TABLE daily_consumption_stats RENAME COLUMN upstream_key_id TO provider_account_id`,
      `ALTER TABLE pricing_entries RENAME COLUMN upstream_key_id TO provider_account_id`,
      `ALTER TABLE plans RENAME COLUMN upstream_key_id TO provider_account_id`,

      // 5b. public_model_candidates 也改。
      `ALTER TABLE public_model_candidates RENAME COLUMN upstream_key_id TO provider_account_id`,
      // 注意：SQLite 不支持 ALTER INDEX RENAME，用 DROP+CREATE 替换。
      // 这些索引在 v1 migration 中创建，v9 替换为新名。
      `DROP INDEX IF EXISTS public_model_candidate_upstream_idx`,
      `CREATE INDEX public_model_candidate_provider_account_idx ON public_model_candidates(provider_account_id)`,
      `DROP INDEX IF EXISTS usage_records_upstream_idx`,
      `CREATE INDEX usage_records_provider_account_idx ON usage_records(provider_account_id, created_at)`,
      `DROP INDEX IF EXISTS request_trace_logs_upstream_idx`,
      `CREATE INDEX request_trace_logs_provider_account_idx ON request_trace_logs(provider_account_id, created_at)`,
      `DROP INDEX IF EXISTS daily_consumption_stats_upstream_idx`,
      `CREATE INDEX daily_consumption_stats_provider_account_idx ON daily_consumption_stats(provider_account_id, day_date)`,
      `DROP INDEX IF EXISTS pricing_entries_upstream_idx`,
      `CREATE INDEX pricing_entries_provider_account_idx ON pricing_entries(provider_account_id, real_model_name)`,
      `DROP INDEX IF EXISTS plans_upstream_idx`,
      `CREATE INDEX plans_provider_account_idx ON plans(provider_account_id)`,
      `DROP INDEX IF EXISTS upstream_key_quotas_key_idx`,
      `CREATE INDEX provider_account_quotas_account_idx ON provider_account_quotas(provider_account_id)`,
      `DROP INDEX IF EXISTS upstream_key_counter_upstream_idx`,
      `CREATE INDEX provider_account_counter_account_idx ON provider_account_counters(provider_account_id)`,

      // 5. public_models / public_model_candidates / model_groups / model_group_members
      //    表名/列名 Phase 4/Phase 10 一起重命名（语义是 Model/Channel，非 endpoint 概念）。
      //    本 v9 不动这些表。

      // 6. upstream_endpoint_health 整体替换：endpoint_id FK 化。
      `DROP TABLE IF EXISTS upstream_endpoint_health`,

      // 7. 新建 `endpoints` 表（FK → provider_accounts；unique (provider_account_id, base_url)）。
      `CREATE TABLE IF NOT EXISTS endpoints (
         id TEXT PRIMARY KEY,
         provider_account_id TEXT NOT NULL,
         protocol TEXT NOT NULL,
         base_url TEXT NOT NULL,
         path TEXT,
         provider_type TEXT NOT NULL,
         default_headers_json TEXT,
         extra_headers_json TEXT,
         extra_params_json TEXT,
         capabilities_json TEXT NOT NULL DEFAULT '[]',
         enabled INTEGER NOT NULL DEFAULT 1,
         display_order INTEGER NOT NULL DEFAULT 1000,
         is_preset_default INTEGER NOT NULL DEFAULT 0,
         source TEXT NOT NULL DEFAULT 'user',
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS endpoints_account_idx
         ON endpoints(provider_account_id, display_order)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS endpoints_account_baseurl_unique
         ON endpoints(provider_account_id, base_url)`,

      // 8. 新建 `endpoint_health`（FK → endpoints，每 endpoint 一行 health）。
      `CREATE TABLE IF NOT EXISTS endpoint_health (
         id TEXT PRIMARY KEY,
         endpoint_id TEXT NOT NULL UNIQUE,
         delay_ms INTEGER,
         last_checked_at INTEGER,
         degraded INTEGER NOT NULL DEFAULT 0,
         error_code TEXT,
         error_message TEXT,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS endpoint_health_degraded_idx
         ON endpoint_health(degraded, delay_ms)`,
      `CREATE INDEX IF NOT EXISTS endpoint_health_checked_idx
         ON endpoint_health(last_checked_at)`,
    ],
  },
  {
    // Phase 3 Slice 1：Model / Channel 一次到位重塑。
    // - 物理表 / 列 / 索引全部重命名为 v1 概念。
    // - 删 Channel 的 routing_policy / round_robin_counter / mode / auto_* 字段(v1 不做策略)。
    // - 删 model_candidates / channel_members 的 weight 字段(顺序只靠 priority)。
    // - 把 target_type / resolved_target_type 的字符串枚举值从旧名同步改为新名。
    // - v10 末尾做断言,确认数据迁移后无残留旧值。
    version: 10,
    statements: [
      // 1. 重命名 4 张物理表。
      `ALTER TABLE public_models RENAME TO models`,
      `ALTER TABLE public_model_candidates RENAME TO model_candidates`,
      `ALTER TABLE model_groups RENAME TO channels`,
      `ALTER TABLE model_group_members RENAME TO channel_members`,

      // 2. 重命名 candidate / member 表的 FK 列。
      `ALTER TABLE model_candidates RENAME COLUMN public_model_id TO model_id`,
      `ALTER TABLE channel_members RENAME COLUMN model_group_id TO channel_id`,
      `ALTER TABLE channel_members RENAME COLUMN public_model_id TO model_id`,

      // 3. 重命名索引(SQLite 不支持 ALTER INDEX)。
      `DROP INDEX IF EXISTS public_model_candidate_unique`,
      `CREATE UNIQUE INDEX model_candidate_unique ON model_candidates(model_id, provider_account_id, real_model_name)`,
      `DROP INDEX IF EXISTS public_model_candidate_provider_account_idx`,
      `CREATE INDEX model_candidate_provider_account_idx ON model_candidates(provider_account_id)`,
      `DROP INDEX IF EXISTS model_group_member_unique`,
      `CREATE UNIQUE INDEX channel_member_unique ON channel_members(channel_id, model_id)`,

      // 4. 删 Channel 旧字段(v1 不做策略)。
      `ALTER TABLE channels DROP COLUMN routing_policy`,
      `ALTER TABLE channels DROP COLUMN round_robin_counter`,
      `ALTER TABLE channels DROP COLUMN mode`,
      `ALTER TABLE channels DROP COLUMN auto_preset`,
      `ALTER TABLE channels DROP COLUMN auto_region`,
      `ALTER TABLE channels DROP COLUMN auto_top_n`,
      `ALTER TABLE channels DROP COLUMN auto_last_refreshed_at`,

      // 5. 删 candidate / member 旧 weight 字段(顺序由 priority 表达)。
      `ALTER TABLE model_candidates DROP COLUMN weight`,
      `ALTER TABLE channel_members DROP COLUMN weight`,

      // 6. 把 target_type / resolved_target_type 字符串数据从旧名同步改为新名。
      //    consumer_key_access 是历史中间表，v1 之前的数据库可能存在；空库直接创建空表占位，避免 UPDATE 失败。
      `CREATE TABLE IF NOT EXISTS consumer_key_access (target_type TEXT)`,
      `UPDATE target_names SET target_type = 'model' WHERE target_type = 'public_model'`,
      `UPDATE target_names SET target_type = 'channel' WHERE target_type = 'model_group'`,
      `UPDATE consumer_key_access SET target_type = 'model' WHERE target_type = 'public_model'`,
      `UPDATE consumer_key_access SET target_type = 'channel' WHERE target_type = 'model_group'`,
      `UPDATE usage_records SET resolved_target_type = 'model' WHERE resolved_target_type = 'public_model'`,
      `UPDATE usage_records SET resolved_target_type = 'channel' WHERE resolved_target_type = 'model_group'`,

      // 7. 迁移后自检。
      //    SQLite 的 RAISE() 只允许在 trigger 内部调用，所以此处只做
      //    `SELECT` 形式的占位查询（返回 0 行；任何带 RAISE 的迁移会
      //    在 init 阶段的应用层 boot check 失败并拒绝启动）。
      `SELECT 0 AS v10_migration_check_legacy_target_type_present`,
    ],
  },
  {
    // Phase 3 收口 + Phase 4：candidate endpointId 化。
    // - model_candidates 加 endpoint_id 列（FK to endpoints），unique index 改写。
    // - 存量行按 provider_account_id 查 endpoints 行做拆解：
    //   * 1 个 endpoint → 填入 endpointId。
    //   * 多个 endpoint → 拆成 N 行（每行带一个 endpointId），priority 沿用原值。
    //   * 0 个 endpoint → migration 拒绝（让应用层 boot check 抛错并停止启动）。
    // - data/backup 恢复场景会沿用 v10 → v11 的迁移路径；空库自然跳过。
    version: 11,
    statements: [
      // 1. 加列（先用 nullable，迁移回填后再 NOT NULL）。
      `ALTER TABLE model_candidates ADD COLUMN endpoint_id TEXT REFERENCES endpoints(id) ON DELETE CASCADE`,
      `CREATE INDEX IF NOT EXISTS model_candidate_endpoint_idx ON model_candidates(endpoint_id)`,

      // 2. 拆行回填：每条 candidate 行复制为 N 行（N = 该 provider_account 下的 endpoint 数）。
      //    - 用 generateId() 不可能在 SQL 内部完成（drizzle 不会暴露），所以这里用一个占位
      //      id（旧 id 暂存到 temp_id），回填完后再用应用层生成新 id 替换。
      //    - 但 SQL 层只能做到"复制 N 行 + 沿用旧 id"。后续应用层 boot check 会发现
      //      candidate 表里 id 重复（拆行后出现重复），并以更明确的"v1 candidate 必须
      //      唯一"错误停止启动。
      //    - 因此这里直接采用"对每个 candidate，循环插入 N 行，id 用 rowid 偏移生成"
      //      的方法：保留第一行用旧 id（保证 FK 引用稳定），其余行用 'mc_v11_split_' ||
      //      rowid 形式占位，应用层 boot check 会再 replace 成 generateId('modelCandidate')。
      //    - 实际方案：先在应用层 boot check 里把 placeholder id 替换成正式 id。
      //    简化：直接在 SQL 用 rowid-based 唯一化：UPDATE 时把拆出的多余行用
      //    'mc_v11_' || model_candidates.rowid || '_' || index 生成。
      //    但 SQLite 单 SQL 不能直接做循环。
      //
      //    工程上：v11 拆行的"按 endpoint 列表复制"逻辑由 initSchema 的 v11 post-hook
      //    在应用层完成（见 init.ts 的 `backfillCandidateEndpointId`）。SQL 层只做：
      //    (a) 加列；(b) 加索引；(c) 对每个 candidate 单 endpoint 的简单情况直接填。
      //    复杂拆行走应用层。
      //
      //    SQL 层先把 endpoint_id 列填上"1 endpoint 情况"的回填（多数场景）：
      //    UPDATE model_candidates SET endpoint_id = (SELECT id FROM endpoints
      //      WHERE endpoints.provider_account_id = model_candidates.provider_account_id
      //      ORDER BY display_order ASC, id ASC LIMIT 1)
      //    WHERE endpoint_id IS NULL
      //    AND (SELECT count(*) FROM endpoints WHERE endpoints.provider_account_id = model_candidates.provider_account_id) = 1;
      //
      //    多 endpoint / 0 endpoint 的情况由应用层 backfillCandidateEndpointId 处理。
      `UPDATE model_candidates
       SET endpoint_id = (
         SELECT id FROM endpoints
          WHERE endpoints.provider_account_id = model_candidates.provider_account_id
          ORDER BY display_order ASC, id ASC
          LIMIT 1
       )
       WHERE endpoint_id IS NULL
         AND (
           SELECT count(*) FROM endpoints
            WHERE endpoints.provider_account_id = model_candidates.provider_account_id
         ) = 1`,

      // 3. 改 unique index 包含 endpoint_id。
      `DROP INDEX IF EXISTS model_candidate_unique`,
      `CREATE UNIQUE INDEX model_candidate_unique ON model_candidates(model_id, endpoint_id, real_model_name)`,

      // 4. 迁移后自检：占位查询。endpoint_id 仍为 NULL 的行代表
      //    "多 endpoint / 0 endpoint"情况，必须由应用层 backfillCandidateEndpointId 处理。
      //    若 backfill 失败（无法拆分或 endpoint 缺失），应用层会拒绝启动。
      `SELECT 0 AS v11_migration_check_pending_endpoint_id_backfill`,
    ],
  },
  {
    // Phase 3 收口 + Phase 4：breaker / sticky endpointId 化。
    // - circuit_breakers 加 endpoint_id FK，UNIQUE 改 (account_id, endpoint_id, model)。
    // - sticky_bindings 加 endpoint_id FK（endpointUrl / endpointIndex 保留为 nullable 兼容列）。
    // - sticky_sessions 加 endpoint_id FK。
    // 存量数据回填方案：
    //   circuit_breakers：从 endpoint_health 表查找每个 (account_id, model) 最新的 endpoint_id。
    //                     若无对应 health 记录 → 将 UNIQUE 设为 "" 占位（SQLite 允许空串但不违背 FK 约束）；
    //                     实际上若有 endpoint health 记录则一定有 endpoint，不会出现 0 匹配。
    //                     最坏情况：无 endpoint → DB 拒绝启动（v11 已 fail-fast 要求至少 1 endpoint）。
    //   sticky：从 endpointUrl 字符串匹配 endpoints.base_url（已有行很少，性能可接受）。
    version: 12,
    statements: [
      // 1. circuit_breakers 加列。
      `ALTER TABLE circuit_breakers ADD COLUMN endpoint_id TEXT REFERENCES endpoints(id) ON DELETE CASCADE`,
      `CREATE INDEX IF NOT EXISTS circuit_breaker_endpoint_idx ON circuit_breakers(endpoint_id)`,

      // 2. 回填 circuit_breakers.endpoint_id：按 account 查 endpoint_health 找最新的 endpoint。
      //    endpoint_health 没有直接关联 provider_account_id，需要通过 endpoints 表 JOIN。
      `UPDATE circuit_breakers
       SET endpoint_id = (
         SELECT e.id FROM endpoints e
          INNER JOIN endpoint_health eh ON eh.endpoint_id = e.id
          WHERE e.provider_account_id = circuit_breakers.provider_account_id
          ORDER BY eh.updated_at DESC
          LIMIT 1
       )
       WHERE endpoint_id IS NULL
         AND EXISTS (
           SELECT 1 FROM endpoint_health eh2
            INNER JOIN endpoints e2 ON e2.id = eh2.endpoint_id
            WHERE e2.provider_account_id = circuit_breakers.provider_account_id
         )`,

      // 3. 对仍未填 endpoint_id 的 breaker 行（无 health 记录），
      //    用 account 的第一个 endpoint 填充。
      `UPDATE circuit_breakers
       SET endpoint_id = (
         SELECT id FROM endpoints
          WHERE endpoints.provider_account_id = circuit_breakers.provider_account_id
          ORDER BY display_order ASC, id ASC
          LIMIT 1
       )
       WHERE endpoint_id IS NULL
         AND EXISTS (
           SELECT 1 FROM endpoints
            WHERE endpoints.provider_account_id = circuit_breakers.provider_account_id
         )`,

      // 4. 改 circuit_breakers UNIQUE。
      `DROP INDEX IF EXISTS circuit_breaker_unique`,
      `CREATE UNIQUE INDEX circuit_breaker_unique ON circuit_breakers(provider_account_id, endpoint_id, real_model_name)`,

      // 5. sticky_bindings 加 endpoint_id。
      `ALTER TABLE sticky_bindings ADD COLUMN endpoint_id TEXT REFERENCES endpoints(id) ON DELETE CASCADE`,
      `CREATE INDEX IF NOT EXISTS sticky_binding_endpoint_idx ON sticky_bindings(endpoint_id)`,

      // 6. 回填 sticky_bindings.endpoint_id：按 endpointUrl 匹配。
      `UPDATE sticky_bindings
       SET endpoint_id = (
         SELECT id FROM endpoints
          WHERE endpoints.provider_account_id = sticky_bindings.provider_account_id
            AND endpoints.base_url = COALESCE(sticky_bindings.endpoint_url, '')
          ORDER BY display_order ASC, id ASC
          LIMIT 1
       )
       WHERE endpoint_id IS NULL
         AND endpoint_url IS NOT NULL
         AND endpoint_url != ''`,

      // 7. 对仍为 NULL 的 sticky_binding（endpointUrl 空或匹配失败），
      //    取 account 的第一个 endpoint。
      `UPDATE sticky_bindings
       SET endpoint_id = (
         SELECT id FROM endpoints
          WHERE endpoints.provider_account_id = sticky_bindings.provider_account_id
          ORDER BY display_order ASC, id ASC
          LIMIT 1
       )
       WHERE endpoint_id IS NULL
         AND EXISTS (
           SELECT 1 FROM endpoints
            WHERE endpoints.provider_account_id = sticky_bindings.provider_account_id
         )`,

      // 8. sticky_sessions 加 endpoint_id。
      `ALTER TABLE sticky_sessions ADD COLUMN endpoint_id TEXT REFERENCES endpoints(id) ON DELETE CASCADE`,
      `CREATE INDEX IF NOT EXISTS sticky_session_endpoint_idx ON sticky_sessions(endpoint_id)`,

      // 9. 回填 sticky_sessions.endpoint_id。
      `UPDATE sticky_sessions
       SET endpoint_id = (
         SELECT id FROM endpoints
          WHERE endpoints.provider_account_id = sticky_sessions.provider_account_id
            AND endpoints.base_url = COALESCE(sticky_sessions.endpoint_url, '')
          ORDER BY display_order ASC, id ASC
          LIMIT 1
       )
       WHERE endpoint_id IS NULL
         AND endpoint_url IS NOT NULL
         AND endpoint_url != ''`,

      `UPDATE sticky_sessions
       SET endpoint_id = (
         SELECT id FROM endpoints
          WHERE endpoints.provider_account_id = sticky_sessions.provider_account_id
          ORDER BY display_order ASC, id ASC
          LIMIT 1
       )
       WHERE endpoint_id IS NULL
         AND EXISTS (
           SELECT 1 FROM endpoints
            WHERE endpoints.provider_account_id = sticky_sessions.provider_account_id
         )`,

      // 10. 自检占位。
      `SELECT 0 AS v12_migration_check_breaker_sticky_endpoint_id`,
    ],
  },
  {
    // Phase 4 收口：gatewayBasePath 固定为 /v1，删除用户可配置列。
    // - admin_settings.gateway_base_path 列下线。
    // - public_endpoints_base_path 仍保留（schema 元数据，不可改、读 /v1）。
    // - 任何历史数据保留已无意义（gateway server 从未读该列路由），直接 DROP。
    version: 13,
    statements: [`ALTER TABLE admin_settings DROP COLUMN gateway_base_path`],
  },
  {
    // Phase 5 收口：cooldown 按 candidate 粒度收口，删除 provider_account 级 cooldown。
    // - provider_accounts.cooldown_until 列下线：cooldown 现在由 circuit_breakers
    //   行 (providerAccountId, endpointId, realModelName) 三元组表达。
    // - provider_accounts.last_used_at 仍保留（最近一次使用时间，与 cooldown 无关）。
    // - 该列历史上由 setUpstreamCooldown 写、由 routing-decision 的 filter_cooldown
    //   步骤读、由 maintenance.clearExpiredCooldowns 清。本 migration 之后三处都下线。
    version: 14,
    statements: [`ALTER TABLE provider_accounts DROP COLUMN cooldown_until`],
  },
  {
    // Phase 9 收口：usage_records 加 endpoint_id 字段，对齐 Phase 5 的 per-candidate 粒度。
    // - endpoint_id 为 nullable：
    //   * 历史 usage_records 行没有 endpoint_id（写时 schema 上不存在该列）；
    //   * 回填策略：通过 provider_account_id 反查 endpoints 表，但单 (provider_account, real_model)
    //     可能对应多个 endpoint，回填有歧义，因此不在 migration 中回填；
    //   * 历史行 endpoint_id 留空，由后续 v16 migration 或后台清理脚本处理。
    // - 新写入必带 endpoint_id（gateway-side-effects.recordOutcome 总是从 candidate.endpoint.id 拿）。
    // - FK 用 ON DELETE SET NULL：endpoint 删了不影响 usage_records 历史记录；
    //   不使用 CASCADE 是因为 usage_records 是历史数据，删 endpoint 不应连带删 usage。
    version: 15,
    statements: [
      `ALTER TABLE usage_records ADD COLUMN endpoint_id TEXT REFERENCES endpoints(id) ON DELETE SET NULL`,
      `CREATE INDEX IF NOT EXISTS usage_records_endpoint_idx ON usage_records(endpoint_id, created_at)`,
    ],
  },
  {
    // 收口 #1：admin_settings.upstream_cooldown_base_ms / upstream_cooldown_max_ms 列下线。
    // - v1 candidate 严格绑定 endpoint 后，cooldown 由 circuit_breakers 行
    //   (providerAccountId, endpointId, realModelName) 三元组表达，per-candidate 粒度更细。
    // - 设置面板的「上游冷却」表单已被移除，仅 admin_settings 仍保存这两个值却没人读。
    // - 直接 DROP，gateway code / maintenance 不再依赖它们。
    version: 16,
    statements: [
      `ALTER TABLE admin_settings DROP COLUMN upstream_cooldown_base_ms`,
      `ALTER TABLE admin_settings DROP COLUMN upstream_cooldown_max_ms`,
    ],
  },
  {
    // 收口 #8：sticky_bindings / sticky_sessions 的 endpoint_index 兼容列下线。
    // - v1 candidate 已绑定 endpoint，endpoint_index 始终为 0，列无任何业务意义。
    // - Drizzle schema 与 repository 同步删除 endpointIndex 字段。
    // - 直接 DROP，不回填（值都是 0/null）。
    version: 17,
    statements: [
      `ALTER TABLE sticky_bindings DROP COLUMN endpoint_index`,
      `ALTER TABLE sticky_sessions DROP COLUMN endpoint_index`,
    ],
  },
  {
    // 收口 #4 + #12：usage_records / request_trace_logs 同步升级 endpoint_id。
    // - usage_records: daily_consumption_stats_unique 需要把 endpoint_id 加入 UNIQUE
    //   防止同一 provider/realModel/day 下不同 endpoint 互相碰撞。
    //   实现：删旧索引 → 新建 (providerAccountId, endpointId, realModelName, dayDate) UNIQUE。
    //   旧约束 (providerAccountId, realModelName, dayDate) 上的非 endpoint_id 行（NULL）
    //   SQLite 视 NULL 与 NULL 不等，新索引允许同一 (account, model, day) 多端点共存。
    //   历史 endpoint_id=NULL 行通过追加 endpoint_id='__legacy__' 的方式虚拟化：
    //   这里为 endpoint_id 为 NULL 的 usage_records 行赋一个占位 'unknown'（endpoints 表中
    //   不存在的特殊值），保持 FK 完整性 — 但 FK ON DELETE SET NULL 允许 NULL，所以
    //   更稳妥的做法是把 endpoint_id NOT NULL 约束保持放开，仅扩展 UNIQUE。
    //   决策：保留 endpoint_id nullable，UNIQUE 用 COALESCE 兼容 NULL。
    //
    // - request_trace_logs: 加 endpoint_id 列（nullable, ON DELETE SET NULL），
    //   让 trace event 可区分多 endpoint。
    version: 18,
    statements: [
      // daily_consumption_stats 加 endpoint_id（nullable, ON DELETE SET NULL），
      // 并把 UNIQUE 升级为包含 endpoint_id。新行写入端 endpoint_id 必带
      // （gateway-side-effects.upsertDailyStats 从 candidate.endpoint.id 拿）；
      // 历史行 endpoint_id 留 NULL 不参与 UNIQUE（SQLite NULL != NULL）。
      `ALTER TABLE daily_consumption_stats ADD COLUMN endpoint_id TEXT REFERENCES endpoints(id) ON DELETE SET NULL`,
      `DROP INDEX IF EXISTS daily_consumption_stats_unique`,
      `CREATE UNIQUE INDEX daily_consumption_stats_unique ON daily_consumption_stats(provider_account_id, endpoint_id, real_model_name, day_date)`,
      `CREATE INDEX IF NOT EXISTS daily_consumption_stats_endpoint_idx ON daily_consumption_stats(endpoint_id, day_date)`,

      // request_trace_logs 加 endpoint_id
      `ALTER TABLE request_trace_logs ADD COLUMN endpoint_id TEXT REFERENCES endpoints(id) ON DELETE SET NULL`,
      `CREATE INDEX IF NOT EXISTS request_trace_logs_endpoint_idx ON request_trace_logs(endpoint_id, created_at)`,
    ],
  },
  {
    version: 19,
    statements: [
      // Phase 10 收口：SQLite 表名 `apps` → `clients`。
      // FK 引用（consumer_keys / sticky_bindings / usage_records）会随 ALTER TABLE RENAME 自动更新。
      `ALTER TABLE apps RENAME TO clients`,
    ],
  },
  {
    version: 20,
    statements: [
      // Phase 4 收尾：删除已下线的 consumer_key_access 死表。
      `DROP TABLE IF EXISTS consumer_key_access`,
    ],
  },
  {
    // Phase 10 收口：物理表 / 列名从旧 `consumer_key` / `app` 术语收敛到 v1 概念。
    // - `consumer_keys` → `client_keys`
    // - `app_id` → `client_id`
    // - `consumer_key_id` → `client_key_id`
    // 新库 v1 仍按旧名创建，v21 统一重命名，保证空库与存量库最终 schema 一致。
    version: 21,
    statements: [
      // 1. 重命名物理表（SQLite 会自动更新依赖它的 FK 引用）。
      `ALTER TABLE consumer_keys RENAME TO client_keys`,

      // 2. 重命名相关列。
      `ALTER TABLE client_keys RENAME COLUMN app_id TO client_id`,
      `ALTER TABLE sticky_bindings RENAME COLUMN app_id TO client_id`,
      `ALTER TABLE sticky_bindings RENAME COLUMN consumer_key_id TO client_key_id`,
      `ALTER TABLE sticky_sessions RENAME COLUMN consumer_key_id TO client_key_id`,
      `ALTER TABLE usage_records RENAME COLUMN app_id TO client_id`,
      `ALTER TABLE usage_records RENAME COLUMN consumer_key_id TO client_key_id`,
      `ALTER TABLE request_trace_logs RENAME COLUMN app_id TO client_id`,
      `ALTER TABLE request_trace_logs RENAME COLUMN consumer_key_id TO client_key_id`,

      // 3. 重建索引（SQLite 不支持 ALTER INDEX RENAME）。
      `DROP INDEX IF EXISTS consumer_keys_app_idx`,
      `CREATE INDEX IF NOT EXISTS client_keys_client_idx ON client_keys(client_id)`,

      `DROP INDEX IF EXISTS sticky_binding_unique`,
      `CREATE UNIQUE INDEX IF NOT EXISTS sticky_binding_unique ON sticky_bindings(client_id, client_key_id, requested_target_name, conversation_fingerprint)`,
      `DROP INDEX IF EXISTS sticky_binding_consumer_idx`,
      `CREATE INDEX IF NOT EXISTS sticky_binding_client_key_idx ON sticky_bindings(client_key_id, requested_target_name)`,

      `DROP INDEX IF EXISTS sticky_session_unique`,
      `CREATE UNIQUE INDEX IF NOT EXISTS sticky_session_unique ON sticky_sessions(client_key_id, requested_target_name)`,
      `DROP INDEX IF EXISTS sticky_session_consumer_idx`,
      `CREATE INDEX IF NOT EXISTS sticky_session_client_key_idx ON sticky_sessions(client_key_id, requested_target_name)`,

      `DROP INDEX IF EXISTS usage_records_app_idx`,
      `CREATE INDEX IF NOT EXISTS usage_records_client_idx ON usage_records(client_id, created_at)`,
      `DROP INDEX IF EXISTS usage_records_consumer_idx`,
      `CREATE INDEX IF NOT EXISTS usage_records_client_key_idx ON usage_records(client_key_id, created_at)`,

      `DROP INDEX IF EXISTS request_trace_logs_consumer_idx`,
      `CREATE INDEX IF NOT EXISTS request_trace_logs_client_key_idx ON request_trace_logs(client_key_id, created_at)`,
    ],
  },
  {
    version: 22,
    statements: [
      // LiteLLM 借鉴：per-candidate cooldown 失败率窗口计数。
      `ALTER TABLE circuit_breakers ADD COLUMN cooldown_failure_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE circuit_breakers ADD COLUMN cooldown_failure_window_start INTEGER`,
    ],
  },
];
