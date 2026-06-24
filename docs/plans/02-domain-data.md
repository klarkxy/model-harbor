# 02 Domain & Data

Phase 1 建立长期主数据库、领域模型和 repository。这个阶段要把旧项目里已经验证过的数据域重新设计成更干净的 schema，不兼容旧库。

## 目标

- SQLite + Drizzle schema。
- 显式 schema version 和 migration runner。
- repository / unit-of-work。
- 核心 domain service。
- 数据库备份基础能力的底层支持。

## 核心数据域

- Admin users / sessions / login attempts。
- Apps / Consumer Keys / Consumer Key access mode。
- Upstream keys / endpoints / quotas / counters。
- Provider presets，包括内置和本地自定义 preset。
- Target names / Public Models / Candidates / Model Groups / Members。
- Sticky bindings / Sticky sessions。
- Circuit breakers / endpoint health。
- Usage records / trace logs / temporary debug content logs / audit events。
- Cost ledger / pricing / token plans。
- Model reference entries。
- Backups metadata。
- Settings。

## Schema 决策

- SQLite 是长期主库，不做 PostgreSQL 兼容。
- 新 schema 从 v1 开始。
- 不迁移旧数据库。
- 所有时间统一使用 timestamp ms 或 ISO 字符串，表内保持一致。
- Secret 永不明文落库。
- Consumer Key 只存 hash、prefix、suffix。
- Upstream secret 存加密 ciphertext。

## Repository 目标

```text
admin-user.repository.ts
app.repository.ts
consumer-key.repository.ts
upstream-key.repository.ts
provider-preset.repository.ts
target.repository.ts
public-model.repository.ts
model-group.repository.ts
routing.repository.ts
quota.repository.ts
sticky.repository.ts
circuit-breaker.repository.ts
endpoint-health.repository.ts
observability.repository.ts
cost-ledger.repository.ts
model-reference.repository.ts
backup.repository.ts
settings.repository.ts
```

## Domain service 目标

- `AdminAuthService`
- `ConsumerKeyService`
- `AccessPolicyService`
- `UpstreamKeyService`
- `ProviderPresetService`
- `PublicModelService`
- `ModelGroupService`
- `RoutingPolicyService`
- `QuotaService`
- `StickyService`
- `CostLedgerService`
- `BackupService`

## 任务清单

1. 建立 Drizzle schema 和 migration runner。
2. 建立 database client 和 test database helper。
3. 建立 unit-of-work / transaction wrapper。
4. 实现管理员、App、Consumer Key 基础 repository。
5. 实现 upstream、preset、model exposure repository。
6. 实现 routing 所需查询 repository。
7. 实现 observability 和 cost ledger 表。
8. 实现 backup metadata 表和 SQLite 快照底层函数。
9. 写核心领域测试。

## 验收标准

- 空库启动可自动创建 schema。
- schema version 可查询。
- repository 单测覆盖核心 CRUD 和事务。
- 创建 public model 会同时写 target namespace。
- 删除 public model / model group 会清理 target namespace。
- Consumer Key 支持 `accessMode = all | restricted`。
- 完整数据库备份函数可在测试中生成快照文件。

## 非目标

- 不实现完整 HTTP API。
- 不实现真实 provider 调用。
- 不实现前端页面。

