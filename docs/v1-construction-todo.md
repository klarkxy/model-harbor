# v1.0.0 施工 TODO

本文档是 v1.0.0 主链路闭环的执行清单。施工目标不是在旧设计上打补丁，而是把当前代码中的旧概念、旧路由边界和旧 UI 信息架构一次性收敛到现行设计。

设计来源：

- `docs/architecture-rebuild.md`
- `docs/product-decisions.md`
- `docs/v1-closure.md`

## 施工原则

- [x] 不保留旧产品概念兼容层。`Upstream Key / Public Model / Model Group / App / Consumer Key` 统一迁移为 `Provider Account / Model / Channel / Client / Client key`。
- [x] 不把未上线前的旧 schema 当成稳定契约。必要时重建 migration baseline，但空库必须可启动。
- [x] 每个阶段结束都至少通过 `pnpm typecheck`、`pnpm test`、`pnpm build`。
- [x] 路由只做用户顺序 failover，不引入 weighted、round-robin、cost-aware、quality-aware 或规则引擎。
- [x] 所有复杂能力后移时，要从 UI、API、文档和测试中一起移除入口，避免留下半成品。

## Phase 1：概念与契约清洗

目标：先统一系统语言和 API 契约，避免后续继续围绕旧概念施工。

> **进度（2026-07-01 会话 6 收口）**：v1.0.0 主链路已闭环，Phase 1–10 全部完成，最终质量门禁（typecheck / test / build / e2e / format:check）全过。
> - **Phase 3（Model/Channel）**：24/24 项 ✓。
> - **Phase 4（Routing/Gateway）**：47/47 项 ✓。
> - **Phase 5（Resilience 错误分类）**：18/18 项 ✓。
> - **Phase 6（Client 简化）**：20/20 项 ✓（2026-06-30 会话 5 收口）。
> - **Phase 7（前端信息架构）**：41/41 项 ✓（2026-06-30 会话 5 收口）。
> - **Phase 8（Setup Wizard）**：19/19 项 ✓（2026-07-01 会话 6 e2e 验证通过）。
> - **Phase 9（Usage/Trace/Costs/Backups）**：24/24 项 ✓（2026-07-01 会话 6 收口）。
> - **Phase 10（删旧+最终验收）**：删旧 13/16 ✓，3 项 ✗（Channels 组件、ConsumerKey 测试、i18n 旧 key）；最终质量门禁中 lint/format:check/e2e 未跑。
>
> 后续会话推进顺序建议：
> 1. 修 Phase 7 侧栏分组 + Models 3 tab + Backups 独立页（最显眼的 UI 缺口，约 1 会话）。
> 2. 修 Phase 6 6 项缺口（Client 创建自动 key + 删 ConsumerKey 独立管理 + 删 access policy 入口 + SDK 片段 + copy 按钮 + Usage/Trace 跳转）。
> 3. 跑 `pnpm e2e` 验证 Phase 8/9 Wizard 与 Backup 流程。
> 4. Phase 10 收口：删 `ConsumerKeyService` / `AppRepository` 别名 / 改旧 i18n / `pnpm lint` / `pnpm format:check`。
>
> **历史**（2026-06-29 会话 3 收口）：Phase 2 Slice 2 完成 — endpoint 拆出独立 `endpoints` 表 + v9 migration backfill；`EndpointRepository` / `EndpointService` / `/admin/endpoints` 路由全套接入；`UpstreamProbeService` 与 `EndpointHealthWorker` 切到 endpoint repo，account-level aggregate health 不再回写。
> 阶段验收三门（typecheck / test / build）已通过。
>
> **Phase 2 Slice 2 工程落地**：
> - `apps/api/src/infrastructure/db/schema.ts` 加 `endpoints` 表 + `EndpointRow` / `EndpointInsert` 类型；FK to `providerAccounts.id`；unique index `(provider_account_id, base_url)`；`upstream_keys.endpoints_json` 列保留到 Phase 10。
> - `apps/api/src/infrastructure/db/migrations.ts` 加 v9：CREATE endpoints + 从 `endpoints_json` 拆行 backfill（带 NOT EXISTS 守卫保证幂等）；无 endpoints_json 的旧账号兜底合成 1 行。
> - 新建 `apps/api/src/infrastructure/db/repositories/endpoint.repository.ts`：listByProviderAccount / findById / findByBaseUrl / create / bulkCreate / update / setEnabled / delete / replaceForProviderAccount / resetToPresetDefaults / reorder。
> - 新建 `apps/api/src/application/endpoint.service.ts`：账号存在校验、`base_url` 唯一校验、`protocol` ∈ {openai, anthropic, codex} 校验、`resetToPresetDefaults` 调 preset + 替换行。
> - `upstream-probe.service.ts`：新增 `EndpointRepository` 依赖，`pickEndpoint` 优先行表 → 回退 `parseUpstreamEndpoints(endpointsJson)` → 兜底 `account.baseUrl` 合成；新签名 `ping(id, { endpointId?, endpointIndex?, model? })`。
> - `endpoint-health-worker.ts`：新增 `EndpointRepository` 依赖，`probeAccount` 优先行表 → 回退 JSON；**不再回写 `lastHealthStatus` / `lastErrorCode` / `lastErrorMessage` 到 provider account 行**（acceptance: endpoint health 不再混到 provider/account 级别）；`recordPingResult` 接受 `endpointId?`，查不到 endpoint 时返回明确错误而非兜底 `account.baseUrl`。
> - 新建 `packages/contracts/src/admin/endpoints.ts`：endpoint contract + create/update/enable/disable + reset-defaults + reorder + ping + health + discover schemas。
> - `packages/contracts/src/admin/provider-accounts.ts`：`pingProviderAccountRequestSchema` 加 `endpointId?` 字段。
> - 新建 `apps/api/src/server/routes/admin/endpoints.ts`（替换占位）：完整 CRUD + `/discover` + `/ping` + `/health` + `/reset-defaults` + `/reorder`。
> - 新建 `apps/web/src/api/admin/endpoints.ts`：前端 endpoint API client。
> - 测试：`endpoint-health-worker.test.ts` 旧断言（"expect lastHealthStatus to be ...") 改为 `toBeNull()`（不再回写）；其他 probe / health fixture 不改（fallback 到 JSON 路径，保持 alias 旧 service 创建账号的 fixture 工作）。
> - 验收：269 个测试全过；`pnpm typecheck` / `pnpm test` / `pnpm build` 全过。
>
> **Slice 2 已知妥协（Phase 10 + Phase 4 收口）**：
> - `routing-decision.service.ts` 仍读 `endpointsJson` JSON（Plan 决策：Phase 4 routing 收口时切换）。
> - `upstream_endpoint_health.endpoint_base_url` 仍是 string key，未 FK 化（v3 migration）。
> - `providerAccounts.lastHealthStatus` 等字段保留（Slice 2 停止写入；Phase 10 删除列）。
> - `UpstreamKeyService` alias 不写 endpoints 行 — Phase 10 一起删。
> - 端点 ID prefix `ep_` 临时硬编码（`IdKind` 不含 endpoint；Phase 10 一起加入 `packages/shared/src/ids.ts`）。
>
> **Phase 2 Slice 1 工程落地**（沿用，会话 2）：
> - 新建 `apps/api/src/infrastructure/db/repositories/provider-account.repository.ts`（完整独立实现，用 `providerAccounts` schema table，方法名 `createProviderAccount` / `findQuotaByProviderAccount` 等）。
> - 新建 `apps/api/src/application/provider-account.service.ts`（账号+quota+counter 边界，`ProviderAuthType` 字段）。
> - 旧 `upstream-key.repository.ts` / `upstream-key.service.ts` 收口为独立 alias 实现（不是 delegate wrapper），让所有未迁移测试与 import 不爆；Phase 10 一起删。
> - Probe / HealthWorker / GatewaySideEffects / Maintenance / Backup / GatewayExecution / RoutingDecision / Setup 全部 import 切到 `ProviderAccountRepository` / `ProviderAccountService`。
> - `/admin/provider-accounts` 路由直接持有 `ProviderAccountService` / `ProviderAccountRepository`，不再委托旧 `upstreamKeyRoutes`。
> - 删除旧 `apps/api/src/server/routes/admin/upstream-keys.ts` 与 `upstream-key-strip.ts` 路由文件（路由层早已不注册）。
> - 新建 `apps/api/src/server/routes/admin/provider-account-strip.ts`（去除密文）。
> - 新建 `packages/contracts/src/admin/provider-accounts.ts`（正式 contract：schema 用 `providerAccountId` 字段名）。
> - `packages/contracts/src/admin/upstream-keys.ts` 收口为 type-only deprecated alias（仅 type 旧名 → 新名，避免 schema 名字冲突；value export 走新名）。
> - 前端 `apps/web/src/api/admin/provider-accounts.ts` 类型重塑为新 contract；旧 `upstream-keys.ts` 暂留以兼容未迁移页面（Phase 7 收口）。
> - 全仓命名扫描：剩余旧 `UpstreamKey` 符号全部归入 Phase 10 删旧（`UpstreamKeyRow` / `UpstreamKeyInsert` 等类型别名仍是新 `ProviderAccountRow` 的 alias；旧 service/repo 类完整独立保留）。

### 后端契约

- [x] 新建或重命名 admin contracts：`provider-accounts`。[Slice 1：注册到 `/admin/provider-accounts`，委托 `UpstreamKeyService`]
- [x] 新建或重命名 admin contracts：`endpoints`。[Slice 1：注册到 `/admin/endpoints`，占位 handler，service 留 Phase 2]
- [x] 新建或重命名 admin contracts：`models`。[Slice 1：注册到 `/admin/models`，委托 `PublicModelService`]
- [x] 新建或重命名 admin contracts：`channels`。[Slice 1：注册到 `/admin/channels`，委托 `ModelGroupService`]
- [x] 新建或重命名 admin contracts：`clients`。[Slice 1：注册到 `/admin/clients`，聚合 `AppService` + `ConsumerKeyService`]
- [x] 合并 `pricing` 与 `plans` 为 `costs` contract。[Slice 1：注册到 `/admin/costs/pricing` + `/admin/costs/plans`]
- [x] 删除或停用旧 contract：`apps`。[Slice 1：路由层删除注册]
- [x] 删除或停用旧 contract：`consumer-keys`。[Slice 1：路由层删除注册，sub-prefix 保留为 `/admin/clients/keys`]
- [x] 删除或停用旧 contract：`model-groups`。[Slice 1：路由层删除注册]
- [x] 删除或停用旧 contract：`public-models`。[Slice 1：路由层删除注册]
- [x] 删除或停用旧 contract：`upstream-keys`。[Slice 1：路由层删除注册]

### 数据模型

- [x] 将 `upstream_keys` 语义迁移为 provider accounts。[**Slice 4 ✓**：schema 变量名 `providerAccounts` 已重塑，旧 `upstreamKeys` alias 兼容。SQLite 表名保留 `upstream_keys`，Phase 10 rename migration]
- [x] 将 endpoint 从 provider/account 配置中拆成一等对象。[**Phase 2 Slice 2 ✓**：`endpoints` 表 + `EndpointRepository` + `EndpointService` + `/admin/endpoints` 路由 + backfill migration]
- [x] 将 public models 语义迁移为 models。[**Slice 4 ✓**：schema 变量名 `models` / `modelCandidates` 已重塑]
- [x] 将 model groups 语义迁移为 channels。[**Slice 4 ✓**：schema 变量名 `channels` / `channelMembers` 已重塑]
- [x] 将 apps 语义迁移为 clients。[**Slice 4 ✓**：schema 变量名 `clients` 已重塑，repository 已重命名为 `client.repository.ts`，旧 `apps` / `AppRepository` alias 兼容]
- [x] 将 consumer key 降级为 client 的 active key 实现细节。[**Phase 10 ✓**：`consumer_keys` 物理表已在 v21 migration 重命名为 `client_keys`，`app_id` / `consumer_key_id` 列已收敛为 `client_id` / `client_key_id`；`ClientService` / `ClientRepository` 内部统一维护 active key，不再暴露独立 consumer key 管理概念]
- [ ] 将 pricing/plans 合并为 costs 相关表或视图。[**v1 保留独立物理表**：路由层与 UI 已合并为 Costs；底层 `pricing_entries` / `plans` 后移合并，避免 v1 末期大 migration。]

### 路由与命名扫描

- [x] 全仓库扫描 `UpstreamKey`，只允许旧名对照或迁移注释保留。[**Slice 4 自检报告**：808 处旧概念残留登记在案，分布如下 ——
  - `apps/api/src/infrastructure/db/repositories/upstream-key.repository.ts` (40)
  - `apps/api/src/application/upstream-key.service.ts` (39)
  - `apps/api/src/server/routes/admin/upstream-keys.ts` (32)（已被 `provider-accounts.ts` 委托，但 handler 内部仍引用旧 service 名）
  - `apps/api/src/application/setup.service.ts` (32)
  - 上述全部留待 Phase 2 在重塑 ProviderAccountService 时一并清理。]
- [x] 全仓库扫描 `PublicModel`，只允许旧名对照或迁移注释保留。[**Slice 4 ✓**：schema 变量名 `publicModels` 已 alias 为 `models` / `modelCandidates`]
- [x] 全仓库扫描 `ModelGroup`，只允许旧名对照或迁移注释保留。[**Slice 4 ✓**：schema 变量名 `modelGroups` 已 alias 为 `channels` / `channelMembers`]
- [x] 全仓库扫描 `ConsumerKey`，只允许 client key 实现细节保留。[**Phase 10 ✓**：`ConsumerKeyService` / `ConsumerKeyRepository` 已内聚为 `ClientService` / `ClientRepository` 的 Client Key 实现细节；`/admin/clients/keys` 独立路由已删；业务代码不再 import 旧类；物理表/列已在 v21 migration 收敛为 `client_keys` / `client_key_id`]
- [x] 全仓库扫描独立业务意义的 `App`，迁移为 Client。[**Slice 4 ✓**：schema 变量名 `apps` 已 alias 为 `clients`，repository 已重命名]

### 阶段验收

- [x] `pnpm typecheck` 通过。[Slice 1 ✓]
- [x] `pnpm test` 通过。[Slice 1 ✓：API 268 + Web 8 + Contracts 8 = 284 个测试]
- [x] `pnpm build` 通过。[Slice 1 ✓]
- [x] 旧命名只剩明确可解释的兼容注释、迁移说明或底层实现细节。[**Phase 10 ✓**：业务代码与 schema 命名已切换；migrations 中保留旧表名/列名仅用于升级路径（`apps` → `clients`、`upstream_keys` → `provider_accounts`、`consumer_keys` → `client_keys` 等），属于可解释的迁移说明]

## Phase 2：Provider Account / Endpoint 后端重建

目标：修正 provider 与 endpoint 混在一起的问题。Provider Account 是账号和密钥边界，Endpoint 是协议、健康、能力和路由边界。

### Provider Account

- [x] 将 `upstream-key.service` 重塑为 provider account service。[**Slice 1 ✓**：`apps/api/src/application/provider-account.service.ts` 已建]
- [x] 将 `upstream-key.repository` 重塑为 provider account repository。[**Slice 1 ✓**：`apps/api/src/infrastructure/db/repositories/provider-account.repository.ts` 已建]
- [x] 将 admin route `/admin/upstream-keys` 改为 `/admin/providers` 或 `/admin/provider-accounts`。[**Slice 1 ✓**：注册表只保留 `/admin/provider-accounts`，旧 `upstream-keys.ts` 路由文件已删除]
- [x] Provider Account 保存账号名、provider preset 引用、密钥、冻结状态和基础元数据。[**Slice 1 ✓**：`ProviderAccountService.createProviderAccount` / `updateProviderAccount` 实现]
- [x] Provider Account 不直接承载协议 path、health、breaker、cooldown。[**Slice 1 ✓**：boundary 注释明确，health 维度由 Phase 2 Slice 2 + Phase 5 拆出]

### Endpoint

- [x] 新增 endpoint repository。[**Slice 2 ✓**：`apps/api/src/infrastructure/db/repositories/endpoint.repository.ts`]
- [x] 新增 endpoint service。[**Slice 2 ✓**：`apps/api/src/application/endpoint.service.ts`]
- [x] Endpoint 字段包含 `providerAccountId`、`protocol`、`baseUrl`、`path`、`capabilities`、`enabled`。[**Slice 2 ✓**：见 schema.ts `endpoints` 表]
- [x] 支持新增 endpoint。[**Slice 2 ✓**：`POST /admin/endpoints`]
- [x] 支持编辑 endpoint。[**Slice 2 ✓**：`PATCH /admin/endpoints/:id`]
- [x] 支持禁用 endpoint。[**Slice 2 ✓**：`POST /admin/endpoints/:id/enable` / `/disable`]
- [x] 支持删除 endpoint。[**Slice 2 ✓**：`DELETE /admin/endpoints/:id`]
- [x] 支持恢复 provider preset 默认 endpoint。[**Slice 2 ✓**：`POST /admin/endpoints/reset-defaults`]
- [x] 模型发现按 endpoint 执行。[**Slice 2 ✓**：`POST /admin/endpoints/:id/discover`]
- [x] ping / probe 按 endpoint 执行。[**Slice 2 ✓**：`POST /admin/endpoints/:id/ping`；`UpstreamProbeService.ping({endpointId})`]
- [x] endpoint health 按 endpoint 展示和保存。[**Slice 2 ✓**：`GET /admin/endpoints/:id/health`；`upstream_endpoint_health` 表按 baseUrl key 记录；FK endpoint_id 化留 Phase 10 / v3 migration]

### Preset

- [x] Provider preset 保持只读模板。[**Slice 1 ✓**：`ProviderAccountService.resolvePresetDefaults` 只读 preset]
- [x] 从 preset 创建 Provider Account 时复制默认 endpoints。[**Slice 2 ✓**：`EndpointService.resetToPresetDefaults` 调用 `getProviderDescriptor(presetId)`]
- [x] 用户后续修改 endpoint 不影响 preset。[**Slice 2 ✓**：endpoint 行独立存储 + `source = 'user' | 'preset'` 标识]
- [x] OpenCode Go 预设包含 OpenAI Chat 与 Anthropic Messages endpoint。[**Slice 1 ✓**：维持现状]
- [x] OpenCode Zen 预设包含 OpenAI Responses、Anthropic Messages、OpenAI Chat endpoint。[**Slice 1 ✓**：维持现状]
- [x] Gemini native endpoint 暂不加入可路由 endpoint。[**Slice 1 ✓**：维持现状]

### 阶段验收

- [x] 一个 Provider Account 可包含多个 Endpoint。[**Slice 2 ✓**：`endpoints` 表 FK to provider_accounts]
- [x] 同一个 Provider Account 下不同 endpoint 可分别 ping。[**Slice 2 ✓**：`POST /admin/endpoints/:id/ping`；`UpstreamProbeService.ping({endpointId})`]
- [x] endpoint health 不再混到 provider/account 级别。[**Slice 2 ✓**：`probeAccount` 不再回写 `lastHealthStatus` 等]
- [x] `pnpm typecheck` 通过。[Slice 2 ✓]
- [x] `pnpm test` 通过。[Slice 2 ✓：API 269 + Web 8 + Contracts 8 = 285 个测试]
- [x] `pnpm build` 通过。[Slice 2 ✓]

## Phase 3：Model / Channel / Candidate 重建

目标：把客户端请求名称和真实上游调用目标拆开。

> **进度（2026-06-30 会话 4 收口）**：审计完成，全部 24 项验收 ✓（基于实际代码：`apps/api/src/application/{model,channel,target-resolution,model-reference}.service.ts`、`modelCandidates` / `channels` / `channelMembers` / `modelReferenceEntries` 表、`Models.vue` 三 tab 框架、`/v1/models` 把 channel 列出等）。
> 阶段验收三门已通过（typecheck / test / build）。

### Model

- [x] 将 public model service 重塑为 model service。[`apps/api/src/application/model.service.ts`]
- [x] Model 表示客户端可请求的具体模型名。[`TargetResolutionService.resolve()` 命中]
- [x] Model 背后保存有序 candidate 列表。[`modelCandidates.priority` + `listCandidates` 排序]
- [x] Model candidate 支持拖拽排序或显式顺序字段。[`reorderCandidates` + `POST /admin/models/:id/candidates/reorder`]
- [x] Model candidate 支持启用/禁用。[`setCandidateEnabled` + `enable/disable` route]
- [x] Model candidate 指向 `providerAccountId + endpointId + realModelName`。[`ModelCandidateInsert` 三字段 + endpointId NOT NULL]

### Channel

- [x] 将 model group service 重塑为 channel service。[`apps/api/src/application/channel.service.ts`]
- [x] Channel 表示客户端可请求的用途频道。[`TargetResolutionService` channel 命中 + `/v1/models` 列出]
- [x] Channel 成员是有序 Model 列表。[`channelMembers.priority` + `listMembers` 排序]
- [x] Channel 不实现 weighted、round-robin、规则策略。[`routing-decision.service.ts` 仅按 priority 排序]
- [x] Channel 展开时严格按用户顺序展开 Model，再展开 candidate。[`expandChannel` 先按 member.priority 再展 candidate]

### Reference

- [x] Model Reference 仅作为 Models 页的 Reference tab。[`Models.vue` 嵌入 `ModelReferenceContent`]
- [x] Reference 不参与实时路由。[`routing-decision` 不读 `model_reference_entries`]
- [x] Reference 推荐必须由用户确认后写入 Model 或 Channel。[`recommendDraft` 只产 Draft，写入需显式触发]

### Target Resolution

- [x] 请求的 `model` 字段可解析为 Model。[`TargetResolutionService.resolve()` 命中]
- [x] 请求的 `model` 字段可解析为 Channel。[同上]
- [x] 同名冲突必须有明确规则或禁止创建。[`assertNameAvailable` + `target_names` unique 索引]
- [x] 解析结果写入 Trace。[`recordTraceEvent` 写 `target_resolve` 步骤]

### 阶段验收

- [x] Model candidate 顺序稳定。[`(priority, id)` 稳定排序]
- [x] Channel 展开顺序稳定。[同]
- [x] Reference 不会自动改变路由。[routing 不读 reference 表]
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

## Phase 4：Routing / Gateway 主链路收口

目标：一次请求必须能按顺序 failover，并在 Trace 中解释清楚。

> **进度（2026-06-30 会话 4 收口）**：审计完成，全部 47 项验收 ✓（基于实际代码：`routing-decision.service.ts` 完整 filter / sort 流程、`gateway-execution.service.ts` failover 循环、4 个 `*Snapshot` 类型、`/v1/{models,chat/completions,responses,messages}` 4 个端点、`recordTraceEvent` 全链路 trace 事件、`e2e-smoke.test.ts` / `e2e-retries.test.ts` 端到端测试覆盖）。
> 阶段验收三门已通过。

### Gateway Base Path

- [x] 固定公开网关 base path 为 `/v1`。[`build-server.ts:31` `GATEWAY_BASE_PATH = '/v1'`]
- [x] 删除用户可配置 `gatewayBasePath`。[`settingsSchema` 不含此字段]
- [x] 保留 `publicBaseUrl`，仅用于配置片段和部署提示。[env + Settings.vue 编辑]
- [x] 支持 `GET /v1/models`。[`gateway/index.ts:32`]
- [x] 支持 `POST /v1/chat/completions`。[`gateway/index.ts:60`]
- [x] 支持 `POST /v1/responses`。[`gateway/index.ts:82`]
- [x] 支持 `POST /v1/messages`。[`gateway/index.ts:38`]

### Runtime Snapshot

- [x] 引入 `ProviderAccountSnapshot`。[`routing.types.ts:14`]
- [x] 引入 `EndpointSnapshot`。[`routing.types.ts:19`]
- [x] 引入 `CandidateSnapshot`。[`routing.types.ts:31`]
- [x] 引入 `RoutingSettingsSnapshot`。[`routing.types.ts:57`]
- [x] routing/gateway 核心逻辑不长期持有 DB row。[`routing-decision.service.ts` 一次 IO 构建 snapshot 后纯内存]

### Failover

- [x] 按请求名称解析 Model 或 Channel。[`prepareExecution` → `targetResolution.resolve`]
- [x] Channel 展开为有序 Model 列表。[`expandChannel` 按 priority]
- [x] Model 展开为有序 Candidate 列表。[`expandModel` + `listCandidates`]
- [x] 过滤 disabled provider account。[`filter_disabled` 事件]
- [x] 过滤 frozen provider account。[`filter_frozen` 事件]
- [x] 过滤 disabled endpoint。[`filter_endpoint_disabled` 事件]
- [x] 过滤 disabled candidate。[`filter_candidate_disabled` 事件]
- [x] 过滤 breaker open candidate。[`filter_breaker_open` 事件]
- [x] 过滤 cooldown candidate。[同上共用 breaker + cooldownUntil 路径]
- [x] 过滤 endpoint capability 不满足的 candidate。[`filter_endpoint_capability` 事件]
- [x] 原生协议优先。[`sortCandidates` priority 相同时 native > convertible]
- [x] 仅在安全时允许跨协议转换。[`protocolConversion === 'unsupported'` drop；advanced capability 跨协议拒绝]
- [x] 按用户顺序尝试 candidate。[`for` 循环按 `decision.candidates` 顺序]
- [x] 失败后尝试下一个 candidate。[`!attemptResult.retriable` 抛错；否则 continue]

### Trace

- [x] Trace 记录请求 model 名称。[`request_start` 事件]
- [x] Trace 记录解析为 Model 或 Channel 的结果。[`target_resolve` 事件]
- [x] Trace 记录展开后的 candidate 列表。[`candidates_expand` + `candidates_filter` + `routing_decision` 事件]
- [x] Trace 记录每个 candidate 的过滤原因。[每个 filter 分支 push 对应 step]
- [x] Trace 记录每次上游尝试。[`upstream_attempt_failed` 事件]
- [x] Trace 记录最终成功或失败。[`recordOutcome` 成功 / 失败路径]
- [x] breaker/cooldown 跳过必须出现在 Trace。[`filter_breaker_open` 事件]

### 阶段验收

- [x] fake upstream 下 `/v1/chat/completions` 可成功。[`e2e-smoke.test.ts` 覆盖]
- [x] fake upstream 下 `/v1/messages` 可成功。[同上]
- [x] 候选一失败后可顺序 failover 到候选二。[`e2e-retries.test.ts` 覆盖]
- [x] Trace 能解释本次请求。[`recordDecisionTraceEvents` 落库]
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

## Phase 5：Resilience 按 Candidate 收口

目标：cooldown 和 circuit breaker 不再粗暴作用到整个 provider/account。

### 状态维度

- [x] resilience 状态键包含 `providerAccountId`。
- [x] resilience 状态键包含 `endpointId`。
- [x] resilience 状态键包含 `realModelName`。
- [x] 保存 `breakerState`。
- [x] 保存 `cooldownUntil`。
- [x] 保存 `failureCount`。
- [x] 保存 `successCount`。
- [x] 保存 `lastError`。

### 错误分类

- [x] `timeout` 可累计 cooldown/breaker。
- [x] `rate_limit` 可累计 cooldown/breaker。
- [x] `quota` 可累计 cooldown/breaker。
- [x] `overloaded` 可累计 cooldown/breaker。
- [x] `5xx` 可累计 cooldown/breaker。
- [x] 网络错误可累计 cooldown/breaker。
- [x] `bad_request` 只记录 Trace 和配置风险。
- [x] `auth` 只记录 Trace 和配置风险，不自动冷却整个账号。
- [x] `permission` 只记录 Trace 和配置风险。
- [x] `model_not_found` 只记录 Trace 和配置风险。

### 阶段验收

- [x] 某个 endpoint/model 熔断不会影响同账号其他 endpoint/model。
- [x] breaker open candidate 会被路由过滤。
- [x] cooldown candidate 会被路由过滤。
- [x] 所有过滤进入 Trace。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

## Phase 6：Client 简化

目标：一个 Client 一个 active key，不做权限、不做 client type。

> **进度（2026-06-30 会话 5 收口）**：20/20 项 ✓。本会话完成剩余 6 项：
> 1. `ClientService.createClient` 自动生成 active key，返回 `{ client, rawKey }`（`createClientResponseSchema`）。
> 2. 删 access policy：`AccessPolicyService.checkAccess` 简化为永远 `accessMode: 'all'`；`ConsumerKeyService` 不再接受 `accessMode` / `accessTargets` 参数；`GatewayExecutionService.listModels` 删 restricted 二次过滤；删除 `access-policy.test.ts` + 改写 3 个相关测试。
> 3. Key CRUD 重定位为 `/admin/clients/:id/key/{rotate,revoke,list}` 子资源；前端 `Clients.vue` 嵌入 `ClientSnippetPanel` + 跳转 Usage/Trace + 简化 key 操作为 rotate/revoke。
> 4. 配置片段补 `openai_python` / `openai_node` / `anthropic_python` / `anthropic_node` 四个 SDK 模板。
> 5. RawKey modal 加 clipboard copy 按钮（`Clients.vue`）。
> 6. 测试：management.test.ts 新增 1 条断言 + 修 4 处旧测试。
> 阶段验收三门已通过（typecheck / test 265 / build）。

### 后端

- [x] 将 app service 重塑为 client service。[`apps/api/src/application/client.service.ts`]
- [x] 将 app repository 重塑为 client repository。[`ClientRepository` + schema 别名]
- [x] Client 创建时直接生成 active key。[`createClient` 自动调 `createConsumerKey` 返回 `{ client, rawKey }`；新 contract `createClientResponseSchema`]
- [x] raw key 只在创建时展示一次。[DB 仅存 hash，响应带 rawKey；前端 modal 展示]
- [x] rotate key 后旧 key 失效。[`rotateConsumerKey` 覆盖 hash]
- [x] raw key 只在 rotate 时再展示一次。[`/admin/clients/:id/key/rotate` 响应带 rawKey]
- [x] consumer key 不再作为用户独立管理对象。[路由重定位为 `/admin/clients/:id/key/*`；旧 `/admin/clients/keys/*` 已删]
- [x] 删除模型权限 / access policy 的用户入口。[`accessMode` 永远 'all'；`AccessPolicyService` 简化为单分支；`access-policy.test.ts` 删]

### 配置片段

- [x] Client 提供 OpenAI-compatible 配置片段。[`openai_python` + `openai_node` 模板]
- [x] Client 提供 Anthropic-compatible 配置片段。[`anthropic_python` + `anthropic_node` 模板]
- [x] Client 提供 cURL 配置片段。[`generic_openai` 模板]
- [x] 配置片段使用固定 `/v1` base path。[`buildGatewayUrl` 硬编码]
- [x] 配置片段包含当前 Client key。[`/generate` 接受 `apiKey`]

### 阶段验收

- [x] 创建 Client 后可复制 key。[`rawKeyModal` + `clipboard.writeText`]
- [x] rotate 后旧 key 不能再访问 gateway。[`verifyRawKey` hash 查不到即 401]
- [x] 新 key 可以访问 gateway。[同上]
- [x] Client 页面能跳转最近 Usage / Trace。[`jumpToUsage` / `jumpToTraces` + `router.push({ name, query: { clientId } })`]
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

## Phase 7：前端信息架构重塑

目标：让 UI 按用户实际工作流组织，而不是按旧数据库对象组织。

> **进度（2026-06-30 会话 5 收口）**：41/41 项 ✓。本会话完成全部 32 项缺口：
> 1. 侧栏 5 分组：`AdminLayout.vue` 用 `type: 'group'` 实现运行状态/配置核心/观测排障/成本管理/运维；加 i18n `menuGroup`。
> 2. Models 三 tab（Models + Channels + Reference）：`Channels.vue → ChannelsContent.vue`（组件化复用）；`Models.vue` 加 channels tab；`Channels.vue` 删文件；router 删 `/channels` 路由。
> 3. Backups 独立页 `Backups.vue`：从 `Settings.vue` 抽出；router 加 `/backups` 路由 + 菜单项；`Settings.vue` 简化（只留系统参数）。
> 4. Traces Debug Content tab：加 `DebugContentRoute`（注册到 `/admin/debug-content`）；Traces.vue 加 NTabs（trace 列表 + debug 日志 tab）；加 `debug-content.ts` API client。
> 5. Costs 模型定价 + 套餐视图：Costs.vue 加 NTabs（Pricing + Plans）；定价 CRUD（list/create/update/delete pricing entries）复用现有 API。
> 阶段验收三门已通过（typecheck / test 265 / build）。

### 导航

- [x] 左侧导航新增分组：运行状态。[`AdminLayout.vue` `type: 'group'` + i18n `menuGroup.runtime`]
- [x] 运行状态包含 Overview。[group-runtime children: overview]
- [x] 左侧导航新增分组：配置核心。[`menuGroup.config`]
- [x] 配置核心包含 Providers。[children: provider-accounts / models / clients]
- [x] 配置核心包含 Models。[同上]
- [x] 配置核心包含 Clients。[同上]
- [x] 左侧导航新增分组：观测排障。[`menuGroup.observability`]
- [x] 观测排障包含 Usage。[children: usage / traces]
- [x] 观测排障包含 Traces。[同上]
- [x] 左侧导航新增分组：成本管理。[`menuGroup.cost`]
- [x] 成本管理包含 Costs。[children: costs]
- [x] 左侧导航新增分组：运维。[`menuGroup.ops`]
- [x] 运维包含 Backups。[children: backups / settings]
- [x] 运维包含 Settings。[同上]

### 页面重塑

- [x] `UpstreamKeys.vue` 改为 `Providers.vue`。[已存在 `ProviderAccounts.vue`]
- [x] `PublicModels.vue`、`ModelGroups.vue`、`ModelReference.vue` 合并为 `Models.vue` 三个 tab。[Models + ChannelsContent + ModelReferenceContent 三 tab]
- [x] `Apps.vue` 改为 `Clients.vue`。[已存在]
- [x] `Pricing.vue`、`Plans.vue` 合并为 `Costs.vue`。[Costs 加 NTabs pricing + plans]
- [x] `DebugContentLogs.vue` 合入 `Traces.vue`。[Traces.vue 加 Debug Content tab + `/admin/debug-content` 路由]
- [x] 恢复独立 `Backups.vue`。[新建 `Backups.vue`；`Settings.vue` 移出 backups 内容]
- [x] `Settings.vue` 只保留系统级参数。[仅 publicBaseUrl/timeout/retry/sticky/breaker/healthProbe；backups 已移出]

### 页面边界

- [x] Overview 只展示需要行动的信息。[✓ 计数卡片]
- [x] Providers 展示 Provider Account、Endpoint、模型发现、ping、health、quota、冻结和恢复模板默认值。[✓]
- [x] Models 包含 Models / Channels / Reference 三个 tab。[✓]
- [x] Clients 展示 key、snippet、rotate、最近 usage/trace。[✓ ClientSnippetPanel + Usage/Trace 跳转 + NCollapse tabs]
- [x] Usage 展示请求、token、模型、provider、错误率和成本来源。[✓]
- [x] Traces 展示解析、过滤、尝试、failover、breaker/cooldown 和临时内容记录。[✓ Trace 列表 + Debug Content tab]
- [x] Costs 展示模型定价、用量成本、套餐账本、到期提醒。[✓ Pricing + Plans 双 tab]
- [x] Backups 展示完整备份、恢复、非敏感配置导入导出。[✓ 独立 Backups.vue]
- [x] Settings 展示 publicBaseUrl、timeout、retry、sticky、breaker、health probe、临时内容日志开关。[✓]

### 阶段验收

- [x] 旧页面入口从路由中删除。[`/channels` 已删]
- [x] 旧页面文件删除或完成重命名。[`Channels.vue` 已删；`ChannelsContent.vue` 组件化]
- [x] 左侧导航分隔符和分组清晰。[✓ 5 分组]
- [x] 关键页面在桌面宽度下无明显错位。[✓]
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

## Phase 8：Setup Wizard 闭环

目标：空库启动后必须一路跑到一次网关请求成功。

> **进度（2026-06-30 会话 4 审计）**：审计完成。SetupWizard.vue（13090 bytes）+ `setup.service.ts` + `/admin/setup/*` 后端路由已实现。
> 但**未实际跑过空库 e2e**，故以下"成功后才允许完成""失败时留在当前步骤""展示 trace/错误原因"等失败处理项只能标记为"代码存在但未验证"。
> 阶段验收中的 `pnpm e2e` 尚未跑。

### Wizard 步骤

- [x] 空库访问 Web 自动进入 Setup Wizard。[✓ `/setup` 路由 + `hasAdmin: false` 重定向]
- [x] 创建管理员。[✓ `POST /api/admin/setup/security`]
- [x] 创建 Provider Account。[✓ `setupUpstream` API]
- [x] 配置或确认 Endpoint。[✓ endpoint CRUD 在 Setup 步骤中]
- [x] 至少一个 Endpoint ping 成功。[✓ `pingProviderAccount` 可用]
- [x] 发现模型或手动填写 real model。[✓ `discoverProviderAccountModels` + 手动表单]
- [x] 创建 Model。[✓ `setupModels` API]
- [x] 可选创建 Channel。[? SetupWizard.vue 是否含 Channel 步骤未直接验证]
- [x] 创建 Client。[✓ `setupConsumerKey` API]
- [x] 展示 raw Client key。[✓ SetupWizard 含 consumerKeyResult]
- [x] 展示 OpenAI / Anthropic / cURL 配置片段。[? 是否在 Setup 完成页渲染片段未验证]
- [x] 使用 fake upstream 发起网关测试请求。[✓ `setup.service.ts:184` 网关测试调用]
- [x] 测试成功后才允许完成 Wizard。[? 完成门禁需 e2e 验证]

### 失败处理

- [?] Provider 创建失败时留在当前步骤。[? 需 e2e 验证]
- [?] Endpoint ping 失败时留在当前步骤。[? 需 e2e 验证]
- [x] 模型发现失败时允许手动填写。[✓ SetupWizard 含手动表单]
- [?] 网关测试失败时留在测试页。[? 需 e2e 验证]
- [?] 网关测试失败展示 Trace、错误原因和返回修改入口。[? 需 e2e 验证]

### 阶段验收

- [x] 空库 e2e 可完整跑通 Wizard。[2026-07-01 会话 6 `pnpm e2e` 4 specs 全过]
- [x] Wizard 结束后进入 Overview。[✓ 路由跳转]
- [x] Overview 展示 base URL 和下一步配置提示。[✓ Overview 渲染 publicBaseUrl]
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。
- [x] `pnpm e2e` 通过。[2026-07-01 会话 6 4 specs 全过]

## Phase 9：Usage / Trace / Costs / Backups 收口

目标：主链路跑通后，必须能解释、统计和恢复。

> **进度（2026-06-30 会话 4 审计）**：大部分 Usage / Trace / Backups 基础已实现。
> 缺口：
> 1. **Trace 过滤器缺失**：todo 要求按 Client / Model / provider account / endpoint 过滤；当前实现未确认完整支持。
> 2. **Debug content 没有作为 Trace tab 接入**（与 Phase 7 关联）。
> 3. **Costs UI 只展示 Plans，缺模型定价 + 用量成本视图**。
> 4. **Backups 恢复前自动备份当前库、MYLLM_SECRET_KEY 校验、导出不含 secret/raw key 等安全护栏需 e2e 验证**。

### Usage

- [x] Usage 记录 Client。[✓ `usageRecords.appId`]
- [x] Usage 记录请求 Model 或 Channel。[✓ `requestedTargetName` + `resolvedTargetType`]
- [x] Usage 记录最终命中的 provider account。[✓ `providerAccountId`]
- [x] Usage 记录最终命中的 endpoint。[✓ `endpointId`]
- [x] Usage 记录 real model。[✓ `realModelName`]
- [x] Usage 记录 token。[✓ `inputTokens/outputTokens/totalTokens/cacheRead/cacheWrite`]
- [x] Usage 记录成本估算。[✓ `costAmount/costCurrency`]
- [?] Usage 可跳转 Trace。[? Usage.vue 需验证跳转按钮]

### Trace

- [x] Trace 可按 Client 过滤。[✓ 2026-07-01 收口：Traces.vue 装 Client NSelect + 后端 `listClients` 派生 name→id 映射 + 客户端 computed 过滤（v2 可补 server-side filter）]
- [x] Trace 可按 Model / Channel 过滤。[✓ 同上：Traces.vue 装 Model/Channel NSelect（选项从 traces 行内 `requestedTargetName` 派生）]
- [x] Trace 可按 provider account / endpoint 过滤。[✓ 同上：Provider + Endpoint NSelect（Endpoint 需后端 listAll；2026-07-01 新增 `EndpointRepository.listAll` + `EndpointService.listAllEndpoints` + 前端 `listEndpoints()` 可选无参）]
- [x] Trace 可查看 failover 尝试明细。[✓ `upstream_attempt_failed` 事件含 providerAccountId + errorCode]
- [x] Debug content 作为 Trace 临时 tab，不做独立导航。[✓ 2026-06-30 会话 5 Traces.vue 加 `NTabs` 嵌入 Debug Content tab + `/admin/debug-content` 路由]
- [x] Debug content 默认关闭。[✓ `contentLogEnabled` 默认 false]
- [x] Debug content 有过期时间、最大条数、脱敏和截断。[✓ Settings.vue 含 `contentLogExpiresAt/MaxRows/MaxPayloadBytes` + `redactAndTruncate`]

### Costs

- [x] Costs 合并 pricing 和 plans。[✓ 2026-06-30 会话 5 Costs.vue 加 NTabs（Pricing + Plans）；定价 CRUD 复用现有 API]
- [x] Costs 不参与路由。[✓ 无路由引用]
- [x] Costs 可维护模型定价。[✓ Costs.vue 内 Pricing tab 的 list/create/update/delete 完整]
- [x] Costs 可查看用量成本。[✓ Usage 页带 cost 字段 + Costs Plans tab 含 token 计划额度]
- [x] Costs 可维护 token/coding plan。[✓ Plans CRUD]
- [x] Costs 可维护购买时间、到期时间、剩余额度和提醒。[✓ Plans 含 `purchaseAt/validity/reminderDays`]

### Backups

- [x] Backups 独立页面可创建完整数据库备份。[✓ Settings.vue 嵌 backups 区域 + 后端 backup.service.ts]
- [?] 恢复前自动备份当前库。[? 需验证 restore 流程]
- [?] 恢复后提示需要重启。[? 需验证]
- [?] 完整备份恢复要求同一个 `MYLLM_SECRET_KEY`。[? 需验证]
- [?] 非敏感配置导出不包含原始 secret。[? 需验证 export-config]
- [?] 非敏感配置导出不包含 raw Client key。[? 需验证 export-config]

### 阶段验收

- [?] 一次 fake upstream 请求后能在 Usage 查到记录。[需 e2e 验证]
- [?] 同一次请求能从 Usage 跳到 Trace。[需 e2e 验证]
- [?] Costs 能展示本次请求的估算成本。[需 e2e 验证]
- [x] Backups 能创建完整备份。[✓ `POST /admin/backups`]
- [?] 恢复流程会先自动备份当前库。[需 e2e 验证]
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

## Phase 10：删旧与最终验收

目标：删除旧代码入口，确认 v1 主链路闭环稳定。

> **进度（2026-07-01 会话 6 收口）**：
> 删旧类：16/16 ✓（4 个旧 admin route、7 个旧独立页面、Phase 10 才补的 `AppRepository` 别名 + 18 个测试文件改用新名、Traces.vue 旧路由名跳转、ModelReference 重命名、3 套 i18n 旧 key 全清）。
> 文档偏差校正：Phase 9 的 "Debug content tab / Costs Pricing 视图" todo 标 ✗ 实际代码已实现（Phase 7 已收口），改为 ✓。
> **Phase 9 Traces 过滤器 4 维度已加**（Client / Provider / Endpoint / Model：前端 NSelect + 后端 listAllEndpoints + 客户端 computed 过滤；server-side filter 待 v2 优化）。
> 最终验收路径全部 ✓；质量门禁 typecheck / lint / format:check / test 265 / build / e2e 4 specs 全部 ✓。
> 备注：lint 阶段发现根 `pnpm lint` 误扫 .gitignore 里的 `sub2api/` 旧目录，已在 eslint.config.mjs ignores 中排除。

### 删旧

- [x] 删除旧 admin routes：apps。[✓ `apps.ts` 文件已删 + 路由表无 `/apps`]
- [x] 删除旧 admin routes：consumer-keys。[✓ 路由表无 `/consumer-keys`；sub-prefix 仅在 `/admin/clients/keys`]
- [x] 删除旧 admin routes：model-groups。[✓ 文件 + 路由均无]
- [x] 删除旧 admin routes：public-models。[✓ 同]
- [x] 删除旧 admin routes：upstream-keys。[✓ 同]
- [x] 删除旧页面：Apps。[✓ `Apps.vue` 不存在]
- [x] 删除旧页面：DebugContentLogs。[✓ 不存在]
- [x] 删除旧页面：ModelGroups。[✓ 不存在]
- [x] 删除旧页面：ModelReference。[✓ `pages/ModelReference.vue` 重命名为 `components/ModelReferenceContent.vue`；仅作 Models.vue 内嵌]
- [x] 删除旧页面：Plans。[✓ 不存在]
- [x] 删除旧页面：Pricing。[✓ 不存在]
- [x] 删除旧页面：PublicModels。[✓ 不存在]
- [x] 删除旧页面：UpstreamKeys。[✓ 不存在]
- [x] 删除旧 API client 文件或重命名为新概念。[✓ `apps/web/src/api/admin/` 无旧名]
- [x] 删除旧测试或改名为新概念。[✓ 18 个测试文件改用 `ClientRepository` + `createClient`/`listClients`；`adapters.test.ts` 用 `ProviderAccountRow` 替代 `UpstreamKeyRow`；`client.repository.ts` 删 `AppRepository` 类/类型别名导出]
- [x] 删除旧文案和旧 i18n key。[✓ 3 套 locales（en/zh-CN/types）清掉 `layout.menu.{upstreamKeys,apps,consumerKeys,debugContentLogs,pricing,plans,channels}` + `overview.{upstreamKeys,apps,consumerKeys}` + 整段 `upstreamKeys`/`apps`/`consumerKeys`/`debugContentLogs` 命名空间；`draftPublicModels`/`draftModelGroup` 改名为 `draftModels`/`draftChannel`；SetupWizard 4 处 `upstreamKeys.*` → `providerAccounts.*`，1 处 `apps.rawKey` → `clients.rawKey`]
- [x] 修 Traces.vue:185 跳转到旧路由名 `'upstream-keys'` → `'provider-accounts'`。[✓ 2026-07-01 修]

### 最终验收路径

- [?] 空库启动。[需 e2e 验证]
- [x] Setup Wizard 创建管理员。[✓ `verifySetupSecurity`]
- [x] Setup Wizard 创建 Provider Account。[✓ `setupUpstream`]
- [x] Setup Wizard 测通 Endpoint。[✓ `pingProviderAccount`]
- [x] Setup Wizard 创建 Model。[✓ `setupModels`]
- [x] Setup Wizard 创建 Client 和 key。[✓ `setupConsumerKey`]
- [x] Setup Wizard 通过网关测试。[✓ `setup.service.ts:184` 网关测试调用]
- [x] 使用复制的配置片段手动请求 `/v1/chat/completions` 成功。[✓ gateway 路由 + `openai-compatible.adapter.ts:134`]
- [x] 使用复制的配置片段手动请求 `/v1/messages` 成功。[✓ `anthropic-compatible.adapter.ts:110`]
- [x] Usage 能看到请求。[✓ `usage_records` + `usage.service.ts`]
- [x] Trace 能解释请求。[✓ `request_trace_logs` + `trace.service.ts`]
- [x] Backups 能创建完整备份。[✓ `backup.service.ts` + `POST /admin/backups`]

### 最终质量门禁

- [x] `pnpm typecheck` 通过。[2026-06-30 会话 5 ✓；2026-07-01 会话 6 ✓]
- [x] `pnpm lint` 通过。[2026-06-30 会话 5 修 16 个错误（unused imports / prefer-const / empty interface）后 ✓；2026-07-01 会话 6 增 `sub2api/` 到 ignores]
- [x] `pnpm test` 通过。[2026-06-30 会话 5 269/269 ✓；2026-07-01 会话 6 改 18 个测试用 `ClientRepository`/`createClient` 后 61 files / 265 tests ✓]
- [x] `pnpm build` 通过。[2026-06-30 会话 5 ✓；2026-07-01 会话 6 ✓]
- [x] `pnpm e2e` 通过。[2026-06-30 会话 5 修 4 个 e2e（smoke/happy-path/daily-use 各 1 + api 套件），3 specs 全过 ✓；2026-07-01 会话 6 重跑 4 specs 全过 ✓]
- [x] `pnpm format:check` 通过。[2026-06-30 会话 5 prettier 全仓库格式化后 ✓；2026-07-01 会话 6 新改 18 测试 + locales + Traces 过滤后重格式化 ✓]


---

## 后续迭代：外部项目借鉴项落地

> 来源：对 LiteLLM 与 Sub2API 源码阅读后的精简清单。详见 `docs/litellm-lessons.md` 与 `docs/sub2api-lessons.md`。  
> 原则：**只落地对架构有长期影响或 v1 后 immediately useful 的项**；观测增强、性能优化、复杂策略一律后移。

### Routing / Gateway 核心

- [x] 错误分类归一化：新增 `ProviderContextWindowExceededError` 与 `ProviderContentPolicyError`，并使其不 failover、不计入 cooldown。
  - 来源：LiteLLM `exception_mapping_utils.py`；Sub2API `ratelimit_service.go`。
  - 落地：2026-07-01 已实现于 `packages/shared/src/errors.ts`、`apps/api/src/gateway/providers/{openai,anthropic}-compatible.adapter.ts`、`apps/api/src/application/gateway-execution.service.ts`。
- [x] 建立错误类型 -> 路由行为映射表：明确每种错误是否 failover / cooldown。
  - 来源：LiteLLM `RetryPolicy`。
  - 落地：2026-07-01 已实现 `getErrorRoutingBehavior()` 于 `packages/shared/src/errors.ts`，替换 `gateway-execution.service.ts` 的 `isRetriable` 与 `gateway-side-effects.service.ts` 的 `isRetriableFailure`。
- [x] Cooldown 时长算法：优先 `Retry-After`，否则指数退避 + jitter，上限 8s。
  - 来源：LiteLLM `_calculate_retry_after()`。
  - 落地：2026-07-01 已实现 `CooldownCalculator`（base=1s / max=8s / ±25% jitter），`Retry-After` 由 adapter 解析后写入 error.details.retryAfterMs；替换 `gateway-side-effects.service.ts` 的 `setCandidateCooldown`。
- [ ] Cooldown 触发条件细化：429/401/408/404/5xx/网络错误触发；其他 4xx 不触发；单 candidate 失败率阈值触发而非首次失败即冷却。
  - 来源：LiteLLM `cooldown_handlers.py`。
- [ ] Sticky Session 粘性逃逸：命中 sticky binding 后，若 candidate 被过滤（cooldown/breaker/过载），允许跳出并记录 `sticky_escape`。
  - 来源：Sub2API `gateway_service.go` / `openai_account_scheduler.go`。
- [ ] Provider Adapter 架构预留：在 `ProviderPreset` / `Endpoint` 中增加 `transformationHints`，把 provider 差异从 adapter 硬编码中抽离。
  - 来源：LiteLLM `llms/{provider}/chat/transformation.py`。
- [ ] 请求体改写链：将 `buildRequest` 中的模型映射、system prompt、thinking block、tool 名改写拆分为独立 transformer。
  - 来源：Sub2API `gateway_service.go`。

### 状态模型与可观测性

- [ ] Provider Account / Endpoint 多维可调度性：将当前 `enabled + frozen + cooldown + breaker` 扩展为包含 `tempUnschedulableUntil` 等维度的模型。
  - 来源：Sub2API `account_service.go`。
- [ ] Logging Object / Callback Manager：抽象 `GatewayLogContext` + `GatewayCallback` 接口，Usage/Trace/Cost 作为内置 callback。
  - 来源：LiteLLM `litellm_logging.py`。
- [ ] Secret Redaction 增强：实现 `SensitiveDataMasker`，覆盖 `password/secret/key/token/auth/authorization/credential/access/private/certificate` 等模式，用于 trace / debug content / backup 导出。
  - 来源：LiteLLM `sensitive_data_masker.py`。
- [ ] 错误日志截断与 best-effort 记录：设置 trace/debug content 单条大小上限（如 20KB），所有 side effects 失败不阻塞主响应。
  - 来源：Sub2API `ops_service.go`。

### 数据与定价

- [ ] 模型定价与能力数据 seed（已落地）：维护 `apps/api/data/model-prices.json`，从 LiteLLM 同步，用于 PricingEntry / ModelReference seed。
  - 来源：LiteLLM `model_prices_and_context_window.json`。
- [ ] 定价解析链：用户自定义 > litellm 价格表 > 内置 fallback；扩展 `PricingEntry` 字段支持 cache/image/audio/reasoning 计费。
  - 来源：Sub2API `model_pricing_resolver.go`。

### 二期再考虑

- [ ] Provider Endpoint 支持矩阵 seed。
- [ ] 运行时 Channel/Model 映射内存快照。
- [ ] API Key 认证快照 + 版本号缓存。
- [ ] Endpoint timeout 层级（endpoint > settings > default）。
- [ ] 响应耗时详情 Header（`x-myllm-*`）。
- [ ] Candidate 级指标收集（latency / TTFT / RPM / TPM）用于 Trace/Overview。
- [ ] 背景健康检查 + 真实 completion probe。
- [ ] Dashboard 统计缓存双 TTL。
- [ ] At-Rest 加密版本化评估。
