# Phase 1 TODO: Domain & Data

目标：建立 SQLite 长期主库、schema、repository、领域服务和底层备份能力。

## Database Foundation

- [x] P1-001 Add Drizzle and SQLite client
  - Depends on: P0-030
  - Deliverables: API dependencies, `src/infrastructure/db/client.ts`
  - Acceptance: test can create in-memory DB connection and close it.

- [x] P1-002 Add schema version table and migration runner
  - Depends on: P1-001
  - Deliverables: `src/infrastructure/db/migrations`, migration runner
  - Acceptance: empty DB migrates to schema version 1.

- [x] P1-003 Add unit-of-work abstraction
  - Depends on: P1-001
  - Deliverables: `unit-of-work.ts`, transaction helper
  - Acceptance: test rolls back failed transaction.

- [x] P1-004 Add database test helper
  - Depends on: P1-002
  - Deliverables: test factory for isolated in-memory/file DB
  - Acceptance: repositories can share helper without leaking state.

## Core Schema

- [x] P1-010 Add admin auth tables
  - Depends on: P1-002
  - Deliverables: `admin_users`, `admin_sessions`, `login_attempts`
  - Acceptance: migration creates indexes and FK constraints.

- [x] P1-011 Add app and consumer key tables
  - Depends on: P1-002
  - Deliverables: `apps`, `consumer_keys`, `consumer_key_access`
  - Acceptance: consumer key has `access_mode = all | restricted`.

- [x] P1-012 Add provider preset tables
  - Depends on: P1-002
  - Deliverables: built-in preset registry storage strategy, local custom preset table if using DB
  - Acceptance: local custom preset can be inserted without secret fields.

- [x] P1-013 Add upstream tables
  - Depends on: P1-002
  - Deliverables: `upstream_keys`, endpoints representation, quotas, counters
  - Acceptance: upstream secret fields are ciphertext-only.

- [x] P1-014 Add target and model exposure tables
  - Depends on: P1-002
  - Deliverables: `target_names`, `public_models`, `public_model_candidates`, `model_groups`, `model_group_members`
  - Acceptance: target name uniqueness covers public models and model groups.

- [x] P1-015 Add routing state tables
  - Depends on: P1-002
  - Deliverables: `sticky_bindings`, `sticky_sessions`, `circuit_breakers`, `upstream_endpoint_health`
  - Acceptance: unique constraints match lookup dimensions.

- [x] P1-016 Add observability tables
  - Depends on: P1-002
  - Deliverables: `usage_records`, `request_trace_logs`, `debug_content_logs`, `daily_consumption_stats`, `audit_events`
  - Acceptance: trace and usage have indexes for recent dashboard queries.

- [x] P1-017 Add cost ledger tables
  - Depends on: P1-002
  - Deliverables: model pricing, provider pricing overrides, token/coding plans, renewal reminders
  - Acceptance: a plan can be linked to provider/upstream or remain generic.

- [x] P1-018 Add model reference tables
  - Depends on: P1-002
  - Deliverables: reference entries and sync status
  - Acceptance: fixed source entries can be upserted by normalized model name.

- [x] P1-019 Add backup metadata and settings tables
  - Depends on: P1-002
  - Deliverables: backup records, singleton settings
  - Acceptance: settings row can be seeded idempotently.

## Repositories

- [x] P1-030 Implement admin user repository
  - Depends on: P1-010, P1-004
  - Deliverables: create/find/update session/login attempts
  - Acceptance: tests cover bootstrap and session expiry lookup.

- [x] P1-031 Implement app and consumer key repositories
  - Depends on: P1-011
  - Deliverables: App CRUD, key CRUD, access mode/access targets
  - Acceptance: tests cover all vs restricted access persistence.

- [x] P1-032 Implement provider preset repository
  - Depends on: P1-012
  - Deliverables: list built-ins, CRUD local custom presets
  - Acceptance: preset never stores raw secret.

- [x] P1-033 Implement upstream key repository
  - Depends on: P1-013
  - Deliverables: CRUD, order, quota, counters, freeze/cooldown
  - Acceptance: tests cover encrypted credential roundtrip via service, not repository.

- [x] P1-034 Implement target/public model/model group repositories
  - Depends on: P1-014
  - Deliverables: transactional create/update/delete helpers
  - Acceptance: deleting target cleans namespace in transaction.

- [x] P1-035 Implement routing state repositories
  - Depends on: P1-015
  - Deliverables: sticky, session sticky, breaker, endpoint health
  - Acceptance: tests cover stale sticky ignored by lookup.

- [x] P1-036 Implement observability repository
  - Depends on: P1-016
  - Deliverables: usage writes, trace writes, debug content writes, audit writes
  - Acceptance: writes are best-effort callable and queryable.

- [x] P1-037 Implement cost ledger repository
  - Depends on: P1-017
  - Deliverables: pricing CRUD, plan CRUD, renewal queries
  - Acceptance: tests cover active/expiring plans.

- [x] P1-038 Implement model reference repository
  - Depends on: P1-018
  - Deliverables: upsert/list/sync status
  - Acceptance: duplicate normalized name updates existing row.

- [x] P1-039 Implement backup repository
  - Depends on: P1-019
  - Deliverables: record/list/delete backup metadata
  - Acceptance: metadata remains separate from actual backup file operations.

## Domain Services

- [x] P1-050 Implement password/session primitives
  - Depends on: P1-030
  - Deliverables: password hashing, session token hashing, expiry helpers
  - Acceptance: tests verify raw password/session not stored.

- [x] P1-051 Implement secret encryption service
  - Depends on: P1-033
  - Deliverables: encrypt/decrypt upstream secrets with app secret
  - Acceptance: wrong secret fails decrypt.

- [x] P1-052 Implement ConsumerKeyService
  - Depends on: P1-031
  - Deliverables: generate/hash/rotate/revoke/access mode
  - Acceptance: raw key returned only by create/rotate service result.

- [x] P1-053 Implement AccessPolicyService
  - Depends on: P1-031, P1-034
  - Deliverables: all/restricted target access checks
  - Acceptance: tests cover public model, model group, denied target.

- [x] P1-054 Implement PublicModelService
  - Depends on: P1-034
  - Deliverables: create/update/delete with target namespace
  - Acceptance: duplicate target names rejected case-insensitively.

- [x] P1-055 Implement ModelGroupService
  - Depends on: P1-034
  - Deliverables: create/update/delete members with business semantic group rules
  - Acceptance: group members point to public models only.

- [x] P1-056 Implement BackupService low-level operations
  - Depends on: P1-039
  - Deliverables: create SQLite file snapshot, verify backup, restore skeleton
  - Acceptance: test can backup and restore a file DB.

## Phase 1 Closure

- [x] P1-090 Add domain-data architecture notes
  - Depends on: P1-001 through P1-056
  - Deliverables: update docs if schema/repository decisions changed
  - Acceptance: plans and architecture stay consistent.

- [x] P1-091 Run full verification
  - Depends on: P1-090
  - Deliverables: typecheck/test/lint results
  - Acceptance: all checks pass.

