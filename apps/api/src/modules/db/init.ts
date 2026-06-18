import type { Db } from './client.js';

const STATEMENTS: readonly string[] = [
  // M1
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

  // Apps
  `CREATE TABLE IF NOT EXISTS apps (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     description TEXT,
     enabled INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,

  // Consumer keys
  `CREATE TABLE IF NOT EXISTS consumer_keys (
     id TEXT PRIMARY KEY,
     app_id TEXT NOT NULL,
     name TEXT NOT NULL,
     key_hash TEXT NOT NULL UNIQUE,
     key_prefix TEXT NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 1,
     revoked_at INTEGER,
     last_used_at INTEGER,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS consumer_keys_app_idx ON consumer_keys(app_id)`,
  `CREATE TABLE IF NOT EXISTS consumer_key_access (
     id TEXT PRIMARY KEY,
     consumer_key_id TEXT NOT NULL,
     target_type TEXT NOT NULL,
     target_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     FOREIGN KEY (consumer_key_id) REFERENCES consumer_keys(id) ON DELETE CASCADE
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS consumer_key_access_unique ON consumer_key_access(consumer_key_id, target_type, target_id)`,
  `CREATE INDEX IF NOT EXISTS consumer_key_access_target_idx ON consumer_key_access(target_type, target_id)`,

  // Upstream keys
  `CREATE TABLE IF NOT EXISTS upstream_keys (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     provider_type TEXT NOT NULL,
     base_url TEXT NOT NULL,
     api_key_ciphertext TEXT NOT NULL,
     api_key_prefix TEXT NOT NULL,
     default_headers_json TEXT,
     supported_models_json TEXT NOT NULL DEFAULT '[]',
     endpoints_json TEXT,
     provider_preset_id TEXT,
     enabled INTEGER NOT NULL DEFAULT 1,
     frozen INTEGER NOT NULL DEFAULT 0,
     frozen_reason TEXT,
     cooldown_until INTEGER,
     last_health_status TEXT,
     last_error_code TEXT,
     last_error_message TEXT,
     last_used_at INTEGER,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  // Migration: add multi-endpoint / preset columns to existing databases.
  // SQLite does not support ADD COLUMN IF NOT EXISTS, so we catch the
  // duplicate-column error and treat it as a no-op.
  `ALTER TABLE upstream_keys ADD COLUMN endpoints_json TEXT`,
  `ALTER TABLE upstream_keys ADD COLUMN provider_preset_id TEXT`,
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

  // Target names (unified namespace for public models and model groups)
  `CREATE TABLE IF NOT EXISTS target_names (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     target_type TEXT NOT NULL,
     target_id TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS target_names_target_idx ON target_names(target_type, target_id)`,

  // Public models
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
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     FOREIGN KEY (public_model_id) REFERENCES public_models(id) ON DELETE CASCADE,
     FOREIGN KEY (upstream_key_id) REFERENCES upstream_keys(id) ON DELETE CASCADE
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS public_model_candidate_unique ON public_model_candidates(public_model_id, upstream_key_id, real_model_name)`,
  `CREATE INDEX IF NOT EXISTS public_model_candidate_upstream_idx ON public_model_candidates(upstream_key_id)`,

  // Model groups
  `CREATE TABLE IF NOT EXISTS model_groups (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     display_name TEXT,
     description TEXT,
     enabled INTEGER NOT NULL DEFAULT 1,
     routing_policy TEXT NOT NULL DEFAULT 'priority',
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

  // Usage records (M5+)
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
     input_tokens INTEGER,
     output_tokens INTEGER,
     total_tokens INTEGER,
     status TEXT NOT NULL,
     error_code TEXT,
     latency_ms INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
     FOREIGN KEY (consumer_key_id) REFERENCES consumer_keys(id) ON DELETE CASCADE,
     FOREIGN KEY (upstream_key_id) REFERENCES upstream_keys(id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS usage_records_created_at_idx ON usage_records(created_at)`,
  `CREATE INDEX IF NOT EXISTS usage_records_app_idx ON usage_records(app_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS usage_records_consumer_idx ON usage_records(consumer_key_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS usage_records_upstream_idx ON usage_records(upstream_key_id, created_at)`,
  // M6: quota counters
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

  // Audit events
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

  // Login rate limiting
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

  // M6: sticky bindings
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
];

export async function initSchema(db: Db): Promise<void> {
  for (const sql of STATEMENTS) {
    try {
      await db.run(sql);
    } catch (err) {
      // SQLite migrations that add columns may fail when the column already
      // exists (e.g. the table was created by a newer schema). We only swallow
      // that specific case so genuine schema errors still surface.
      if (
        sql.trim().toUpperCase().startsWith('ALTER TABLE') &&
        err instanceof Error &&
        /duplicate column name/i.test(err.message)
      ) {
        continue;
      }
      throw err;
    }
  }
}
