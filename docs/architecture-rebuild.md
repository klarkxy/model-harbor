# ManageYourLLM 重构架构设计

本文档是 `codex/rebuild-clean` 分支的第一份重构蓝图。目标是保留当前项目已经验证过的产品能力，同时用更清晰的分层、边界和模块职责重建实现。当前项目位于 `D:\0 code\llm-router`，参考项目 `reference/cc-switch` 位于旧项目目录内。

## 1. 重构目标

ManageYourLLM 是一个个人自用的大模型网关与 Provider 管理台，中文定位是“管理你的大模型”。它不是组织平台，不是转售平台，不包含充值、支付、分账、团队账务或多租户治理。核心目标是让个人用户用一个简单、稳定、可解释的控制台管理上游 Provider、公共模型、客户端接入、路由稳定性、用量成本和套餐周期。

重构的优先级按以下顺序排列：

1. 稳定路由 / failover。
2. 管理 UI 好用。
3. 部署简单。
4. 长期可维护、好重构、好加功能。

技术栈保持保守，不通过换技术栈解决问题，通过重新划分边界解决问题。

重构后的系统必须继续支持：

- 管理上游供应商密钥、认证方式、endpoint、模型发现和健康状态。
- 将上游真实模型映射为下游可见的公共模型名。
- 通过模型组表达业务语义，如 `coder`、`fast`、`cheap`。
- 为 App 生成 Consumer Key；默认可访问全部模型，也可切换为 public model / model group 级限制。
- 支持 Anthropic Messages、OpenAI Chat Completions、OpenAI Responses 三类下游协议。Codex 路由本质上就是 OpenAI Responses 协议，不单独做 Codex auth。
- 通过候选过滤、负载策略、粘性、熔断、冷却、健康排序和 failover 提高可用性。
- 默认只记录统计和元数据；内容日志只作为临时调试模式，短窗口开启、自动关闭。
- 提供个人成本与套餐账本：请求成本估算、token/coding plan、购买和续费时间、到期提醒。
- 提供模型参考榜单，首版作为配置助手，不参与实时路由。
- 管理端全程可视化配置，不要求用户编辑 YAML 或数据库。
- 生产部署支持公网场景，但仍保持单进程、SQLite、Docker 友好。

重构后的代码目标：

- 业务规则从 HTTP route 中移出，进入 application service / domain service。
- 路由核心不直接依赖 Fastify、Drizzle、SQLite、Vue 或任何 provider wire format。
- provider 接入通过 descriptor + adapter 扩展，新增 provider 尽量不触碰路由核心。
- 数据写入统一经过 repository / unit-of-work，关键变更有事务边界。
- 可观测性、审计、内容日志、用量统计作为副作用端口，不污染路由决策。

首版不做：

- Codex OAuth / codex-auth。
- 组织、租户、RBAC、SSO/OIDC。
- 充值、售卖、支付回调、分账、发票。
- PostgreSQL 兼容和旧数据库自动迁移。
- 自动写入 Claude Code、Codex、OpenCode、Hermes 或 Cherry Studio 本机配置文件。
- Tauri/桌面托盘伴侣程序。托盘程序可作为后续增强，只负责打开管理台、展示状态和快捷入口。

## 2. 来自现有项目的事实

当前项目是 pnpm monorepo，重构版继续沿用这条技术路线：

```text
apps/
  api/       Fastify 5 + TypeScript + Drizzle/libsql
  web/       Vue 3 + Vite + Naive UI + Pinia
packages/
  shared/    协议类型、错误、IR、provider descriptor
docs/        管理员文档
e2e/         Playwright
```

目标技术栈：

- 后端：Node.js + TypeScript + Fastify。
- 数据库：SQLite 长期主数据库 + Drizzle。首版不为 PostgreSQL 做正式设计。
- 前端：Vue 3 + Vite + Naive UI。
- Monorepo：pnpm workspace。
- 契约与校验：Zod 共享 schema。
- 测试：Vitest + Playwright。
- 部署：Node 直跑和 Docker 都支持；公网/生产推荐 Docker。

现有后端核心模块：

- `auth`：管理员认证、Consumer Key 校验、密码和 session。
- `admin`：上游 key、公共模型、模型组、App、Consumer Key、设置、审计、用量 API。
- `providers`：Anthropic/OpenAI/Coze/Codex adapter、auth strategy、provider descriptor 兼容层。
- `router`：目标解析、访问控制、候选展开与过滤、模型组负载策略、熔断。
- `gateway`：协议入口、非流式/流式请求处理、上游发送、错误映射、冷却。
- `sticky`：conversation sticky 和短窗口 session sticky。
- `quota`：上游 key 配额和周期计数。
- `observability`：usage、trace、content log、audit、redaction、consumption stats。
- `jobs`：维护任务，清理过期数据、重置计数、健康探测。

现有数据模型已经较完整，包括：

- 管理员：`admin_users`、`admin_sessions`、`login_attempts`
- 下游接入：`apps`、`consumer_keys`、`consumer_key_access`
- 上游接入：`upstream_keys`、`upstream_key_quotas`、`upstream_key_counters`、`oauth_sessions`
- 路由目标：`target_names`、`public_models`、`public_model_candidates`、`model_groups`、`model_group_members`
- 韧性：`sticky_bindings`、`sticky_sessions`、`circuit_breakers`、`upstream_endpoint_health`
- 观测：`usage_records`、`request_trace_logs`、`content_logs`、`model_consumption_stats`、`audit_events`
- 设置：`admin_settings`
- 模型参考：`model_reference_entries`、`model_reference_sync_status`

主请求路径：

```text
client request
  -> consumer key auth
  -> wire request to ChatRequestIR
  -> resolve target name
  -> assert access
  -> expand candidates
  -> quota/capability/state/protocol/circuit filtering
  -> endpoint health sort
  -> group balancing
  -> sticky/session sticky reorder
  -> attempt candidates with failover
  -> provider adapter builds upstream request
  -> sender performs HTTP request
  -> adapter normalizes response or error
  -> write quota, sticky, usage, trace, content log, consumption stats
  -> return client protocol response
```

当前主要架构痛点：

- route 文件承担过多业务职责，尤其 `admin/upstream-keys.ts` 同时处理 CRUD、discover、ping、onboarding、quota、audit、duplicate、OAuth 草稿等。
- `gateway/handler.ts` 是高价值但过重的流程编排模块，路由决策、副作用写入和错误处理混在一起。
- 数据访问分散在 service / route / router 中，事务边界不够集中。
- 前后端 API 类型存在重复，web 端手写大量响应类型，容易和后端漂移。
- provider descriptor 已经进入 shared，但 adapter、auth、model discovery、capabilities 的边界还可以更正式。

## 3. 可吸收的 cc-switch 设计

`reference/cc-switch` 是一个成熟 Tauri 项目，领域不同，但有几类设计非常值得借鉴。

第一，清晰分层：

```text
Frontend
  Components
  Hooks
  TanStack Query

Backend
  Commands/API
  Services
  DAO
  SQLite
```

对应到 ManageYourLLM，应采用：

```text
HTTP routes
  -> application services
  -> domain services
  -> repositories/unit of work
  -> database
```

第二，SSOT。cc-switch 把 SQLite 作为主要真相来源，只把设备级 UI 设置放 JSON。ManageYourLLM 应把业务数据完全放数据库，环境变量只负责启动配置和 secret 注入。

第三，DAO / repository 集中数据访问。cc-switch 的 `database/dao/providers.rs` 把 provider 查询、排序、当前项、保存、队列等封装起来。ManageYourLLM 应避免 route 直接拼复杂 SQL。

第四，provider router 与 failover 副作用分离。cc-switch 的 `ProviderRouter` 负责选择候选和熔断状态，`FailoverSwitchManager` 负责切换后的 UI/状态通知。ManageYourLLM 可借鉴为：

- `RoutingDecisionService`：只决定候选顺序和尝试策略。
- `GatewayExecutionService`：执行候选请求。
- `RoutingSideEffects`：写 trace、usage、quota、sticky、cooldown、breaker。

第五，adapter trait 统一 provider 差异。cc-switch 的 provider adapter 明确包含 base URL、auth、URL 构建、请求/响应转换。ManageYourLLM 应继续保留并强化现有 adapter 接口。

第六，备份和迁移保护。cc-switch 在 schema upgrade 前备份数据库。ManageYourLLM 以 SQLite 为长期主数据库，备份/恢复应作为首版重点能力，而不是后补工具。

第七，前端 query 层。cc-switch 使用 API wrapper + query cache，使 UI 组件少处理异步细节。ManageYourLLM 当前 Vue 项目可继续用 Pinia，但建议新增“resource query/composable”层，页面只组合状态和操作。

不建议直接照搬的部分：

- Tauri/Rust 桌面命令层不适用于当前 Web 网关。
- live config 双向同步、深链导入、桌面文件原子写入不是 ManageYourLLM 当前核心。
- cc-switch 的商业 sponsor/多工具配置域不应进入 ManageYourLLM。

## 4. 目标分层

建议新后端目录：

```text
apps/api/src/
  main.ts
  server/
    build-server.ts
    http-errors.ts
    plugins/
    routes/
      admin/
      gateway/
      health.ts
  config/
  domain/
    auth/
    access/
    upstream/
    model-catalog/
    cost-ledger/
    backups/
    routing/
    gateway/
    observability/
    settings/
  application/
    admin/
      upstream-key.service.ts
      public-model.service.ts
      model-group.service.ts
      app.service.ts
      consumer-key.service.ts
      setup-wizard.service.ts
      settings.service.ts
      cost-ledger.service.ts
      backup.service.ts
    gateway/
      gateway-orchestrator.ts
      stream-orchestrator.ts
    maintenance/
      maintenance.service.ts
  infrastructure/
    db/
      schema/
      migrations/
      repositories/
      unit-of-work.ts
    providers/
      adapters/
      auth/
      discovery/
      registry/
    http/
      upstream-sender.ts
    crypto/
    clock/
    logging/
  contracts/
    admin-api.ts
    gateway-api.ts
```

依赖方向：

```text
server/routes -> application -> domain
application -> repository interfaces + provider interfaces
infrastructure -> domain/application ports
```

禁止方向：

- `domain` 不导入 Fastify、Drizzle、libsql、pino、Vue。
- `domain/routing` 不导入 provider wire request/response 类型，只处理 IR、capabilities、candidate、policy。
- `server/routes` 不直接写数据库。
- `providers/adapters` 不直接写 usage、trace、quota。

## 5. 核心领域边界

### 5.1 Identity & Access

职责：

- 管理员登录、session、密码变更、登录限流。
- Consumer Key 生成、哈希、撤销、轮换。
- App 与 Consumer Key 的授权关系。

关键服务：

- `AdminAuthService`
- `ConsumerKeyAuthService`
- `AccessPolicyService`

关键规则：

- Consumer Key 原文只在创建/轮换时返回一次。
- Consumer Key 默认 `accessMode = all`，适合个人自用的低摩擦接入。
- 需要隔离时切换为 `accessMode = restricted`，再通过 `consumer_key_access` 授权 public model / model group。
- 网关认证优先读取 `Authorization: Bearer`，Anthropic 兼容读取 `x-api-key`。
- 管理后台使用本地管理员账号、密码和 HTTP-only session cookie；不做 OIDC/SSO/RBAC。

### 5.2 Upstream

职责：

- 上游 key CRUD、排序、启用/禁用、冻结/解冻。
- 认证策略首版以 PAT 为主；Coze OAuth 后移；不做 Codex OAuth。
- 多 endpoint、provider preset、extra headers/params。
- 模型发现、ping、健康探测、candidate onboarding。
- 内置核心 provider preset，并支持本地自定义 preset。

关键服务：

- `UpstreamKeyService`
- `UpstreamCredentialService`
- `ProviderDiscoveryService`
- `EndpointHealthService`

从 cc-switch 借鉴：

- provider 保存逻辑应有 repository 封装。
- 排序和 failover 队列应作为明确模型，不散落在 UI 操作里。

### 5.3 Model Exposure

职责：

- `target_names` 维护全局唯一名字。
- 公共模型与候选管理。
- 模型组与成员管理。
- 模型参考数据和自动推荐。

关键服务：

- `TargetNameService`
- `PublicModelService`
- `ModelGroupService`
- `ModelReferenceService`

关键规则：

- Public Model 是多供应商池 / 同语义模型别名。例如 `gpt-5` 可以有 OpenAI、OpenRouter、relay 等多个候选。
- Model Group 是业务语义组。例如 `coder`、`fast`、`cheap`、`reasoning`，成员是多个 public model。
- 公共模型名和模型组名共享命名空间。
- 名称大小写不敏感，存储建议小写。
- 创建上游 key 可辅助创建 public model + candidate，但不自动创建模型组。
- 模型参考榜单首版是配置助手：展示参考信息、辅助生成 public model / model group 推荐，经用户确认后写入。

### 5.4 Routing

职责：

- 目标解析。
- 展开 public model / model group 为候选。
- 过滤不可用候选。
- 按策略排序。
- 计算 sticky 命中。
- 输出可尝试候选列表和过滤原因。

建议把当前 `runGateway` 的前半部分抽为纯粹的 `RoutingDecisionService`：

```ts
interface RoutingDecisionInput {
  appId: string;
  consumerKeyId: string;
  requestedTargetName: string;
  sourceProtocol: SourceProtocol;
  rawRequest: unknown;
  ir: ChatRequestIR;
  now: Date;
}

interface RoutingDecision {
  target: ResolvedTarget;
  candidates: ResolvedCandidate[];
  dropped: CandidateDrop[];
  stickyHit: StickyHit | null;
  sessionStickyHit: StickyHit | null;
}
```

过滤顺序：

1. candidate enabled
2. public model enabled
3. upstream enabled
4. upstream not frozen
5. cooldown expired
6. quota not exceeded
7. circuit breaker allows request
8. required capabilities satisfied
9. protocol match, otherwise fallback bucket

路由策略：

- 默认可预测、可解释，未来允许新增智能策略。
- failover 采用激进模式：上游返回 auth、permission、model_not_found、bad_request、rate_limit、quota、timeout、overloaded、network 等错误时，都继续尝试后续候选，直到候选耗尽或达到最大尝试数。
- 对 `bad_request`、`auth`、`permission`、`model_not_found` 等错误要完整写入 trace，但是否触发长冷却应谨慎，避免把客户端请求问题误判为上游不可用。
- sticky routing 是核心能力，不是后续优化。conversation sticky 和短窗口 session sticky 都参与候选排序，但不能绕过禁用、冻结、配额、熔断、能力不匹配等过滤。

### 5.5 Gateway Execution

职责：

- 将 IR 交给 provider adapter 构建上游请求。
- 解析上游响应。
- 尝试候选并执行 failover。
- 将结果映射回下游协议。

建议接口：

```ts
interface ProviderAdapter {
  id: ProviderType;
  capabilities: ProviderCapabilities;
  buildRequest(ctx: ProviderRequestContext): ProviderHttpRequest;
  normalizeResponse(ctx: ProviderResponseContext): NormalizedChatResponse;
  normalizeError(ctx: ProviderErrorContext): NormalizedProviderError;
  stream?: ProviderStreamAdapter;
}
```

`GatewayExecutionService` 只负责请求尝试，不直接决定哪些候选可用。失败后返回结构化 attempt 结果，让 side effect 层记录 cooldown、breaker、trace。

### 5.6 Observability

职责：

- request trace。
- usage records。
- daily consumption stats。
- audit events。
- temporary debug content logs。
- redaction。

设计原则：

- 网关响应不能因为观测写入失败而失败。
- 审计事件用于管理动作，usage/trace 用于网关请求。
- 内容日志不是长期审计功能，只做临时调试模式：短时间或最近 N 条，自动关闭，写入前脱敏和截断。
- trace id 返回给下游，但不传给上游。
- trace 固定保留 30 天；usage records 和 daily consumption stats 长期保留；content debug logs 短保留。

### 5.7 Personal Cost & Plan Ledger

职责：

- 管理 provider/model token 单价。
- 估算每次请求成本。
- 按日/月统计请求、token 和成本。
- 记录个人 coding plan / token plan。
- 维护购买时间、到期时间、周期额度、手动剩余额度、备注和续费提醒。

首版目标：

- 成本统计和套餐维护优先。
- 预算阈值、额度快用完提醒、余额优先路由作为预留能力。
- 不做充值、支付、用户余额、分账或企业账单。

### 5.8 Backup & Restore

职责：

- 手动生成 SQLite 数据库快照。
- 升级或迁移前自动备份。
- 定期自动备份并保留最近 N 个快照。
- 从备份恢复，恢复前先备份当前库。
- 导出非敏感配置包。

备份类型：

- 完整数据库备份：包含加密后的上游 key、Consumer Key hash、配置和用量。恢复时必须使用同一个 `SECRET_KEY` 才能解密上游 key。
- 非敏感配置导出：不包含原始 secret，可导出 provider preset、public model、model group、settings、pricing、plan ledger 等骨架配置，导入后需要重新填写上游 key。

### 5.9 Setup Wizard

首次启动显示 Setup Wizard，之后可从管理台重新打开。

流程：

1. 安全检查：管理员密码、secret key、public base URL、HTTPS/反代提醒。
2. 添加第一个 upstream：选择 provider preset、填写 API key、测试连接。
3. 发现模型：拉取模型、勾选要暴露的 public model。
4. 创建 Consumer Key：默认 `accessMode = all`，展示一次 raw key。
5. 测试请求：生成 curl / OpenAI / Anthropic / Responses 示例。

模型参考榜单可在模型选择步骤作为可选推荐入口，推荐结果必须由用户确认后才写入配置。

## 6. Provider Descriptor 与 Adapter

现有 shared package 已经包含 provider registry，这是重构应保留并提升的方向。

建议 descriptor 表达静态能力：

```ts
interface ProviderDescriptor {
  id: string;
  metadata: {
    displayName: string;
    docsUrl?: string;
    statusPageUrl?: string;
    apiKeyUrl?: string;
  };
  branding?: {
    icon?: string;
    color?: string;
  };
  endpoints: ProviderEndpointDescriptor[];
  authStrategies: {
    default: UpstreamAuthType;
    available: UpstreamAuthType[];
  };
  capabilities: ProviderCapabilities;
  modelSyncUrl?: string;
  defaultModel?: string;
  modelExamples?: string[];
  defaultExtraHeaders?: Record<string, string>;
  defaultExtraParams?: Record<string, unknown>;
}
```

adapter 表达运行时行为：

- wire request 构建。
- wire response 归一化。
- wire error 归一化。
- stream 转换。
- usage 提取。

descriptor 不应保存用户 secret。上游 key 行保存用户配置、密文、endpoint override 和 extra params。

## 7. 数据访问与事务

参考 cc-switch 的 DAO 方式，新项目按 aggregate 建 repository。Phase 1 落地后的 repository 目录如下：

```text
infrastructure/db/repositories/
  admin-user.repository.ts
  app.repository.ts
  consumer-key.repository.ts
  upstream-key.repository.ts
  provider-preset.repository.ts
  target.repository.ts
  public-model.repository.ts
  model-group.repository.ts
  routing-state.repository.ts   # sticky / breaker / endpoint health 合并
  observability.repository.ts   # usage / trace / debug content / audit / daily stats
  cost-ledger.repository.ts     # pricing / plans
  model-reference.repository.ts
  backup.repository.ts
  settings.repository.ts
```

事务规则：

- 创建公共模型必须同时写 `public_models`、`target_names`、candidates。
- 删除公共模型或模型组必须同时清理 target namespace。
- 创建上游 key + onboarding candidates 应在同一个事务内尽量完成；外部 discovery 不属于事务。
- Consumer Key 创建和 access 写入必须同事务。
- 配额计数、usage、trace 可以 best-effort，但同一个 repository 内应保证单次写入原子。

迁移规则：

- 使用显式 schema version。
- 生产环境 destructive migration 前提供备份建议或自动备份钩子。
- 所有迁移幂等，支持从旧版本逐步升级。

## 8. 前端架构

可以继续使用 Vue 3 + Naive UI + Pinia。建议新增 resource composables，使页面只做组合和展示。

```text
apps/web/src/
  api/
    client.ts
    contracts.ts
  resources/
    useUpstreamKeys.ts
    usePublicModels.ts
    useModelGroups.ts
    useApps.ts
    useUsage.ts
    useSettings.ts
  pages/
  components/
  stores/
  theme/
  i18n/
```

页面边界：

- Overview：系统总览、风险提示。
- Upstream Keys：provider preset、密钥、endpoint、模型发现、ping、健康、排序、复制。
- Public Models：公共模型和候选编排。
- Model Groups：手动组和自动推荐快照。
- Apps：App、Consumer Key、授权。
- Usage：用量、trace、consumption stats、临时内容调试入口。
- Cost & Plans：请求成本、模型定价、token/coding plan、购买/续费时间、到期提醒。
- Backups：手动备份、自动备份列表、恢复、非敏感配置导出。
- Settings：熔断、endpoint health、streaming、public endpoint base path、账号、安全检查。
- Setup Wizard：首次配置和重新配置入口。

UI 工作流：

- 首次配置使用向导。
- 日常维护使用高密度表格、抽屉编辑、批量操作。
- 模型发现后进入“确认映射”工作流，而不是要求手动填写所有字段。
- 路由问题排查应能从 Usage/Trace 跳转到相关 upstream key / public model。
- 成本和套餐功能以个人账本呈现，不做企业财务系统。
- 中文优先，保留 i18n 结构；首版不强制完整多语言。

客户端配置助手：

- 首版重点：Claude Code、Codex 类客户端、OpenCode、Hermes、Cherry Studio。
- 只生成可复制配置片段，不自动写本机配置文件。
- 配置助手提供 base URL、API key、model、环境变量、JSON/TOML 片段和协议说明。

从 cc-switch 借鉴：

- API wrapper + query/composable 层。
- 拖拽排序抽象为可复用 composable。
- 表单校验使用 schema，而不是页面里散落 if 判断。
- 复杂弹窗拆成 feature component，不把页面变成巨型文件。

## 9. 网关详细流程

非流式：

```text
GatewayRoute
  parse protocol route
  authenticate consumer key
  build ChatRequestIR
  call GatewayOrchestrator.handle()

GatewayOrchestrator
  create trace
  call RoutingDecisionService.decide()
  call GatewayExecutionService.tryCandidates()
  call RoutingSideEffects.afterAttempt/afterSuccess/afterFailure()
  return GatewayResult

GatewayRoute
  map GatewayResult to Anthropic/OpenAI/Codex response shape
```

流式：

```text
GatewayRoute
  authenticate
  build StreamRequestContext
  call StreamOrchestrator.handle()

StreamOrchestrator
  decision
  attempt candidate stream
  enforce first-token timeout before committing response
  if first token timeout, cancel and try next candidate
  once first token arrives, stream is committed
  parse usage events best-effort
  write final usage/trace after close/error
```

重要行为：

- 跨协议非流式允许 adapter 转换。
- 跨协议流式默认不支持，除非 adapter 明确声明可转换。
- failover attempt 上限保留，避免单请求串行拖垮。
- 激进 failover 是产品决策：所有上游错误都可尝试后续候选。最终错误应尽可能解释“所有候选失败”的上下文，并在 trace 中保留每次失败原因。

## 10. 错误模型

保留旧项目 shared package 的 normalized error 思路；重构后包名应随 ManageYourLLM 重新命名。

- validation
- authentication
- permission
- target_not_found
- no_route_available
- provider_rate_limit
- provider_quota
- provider_timeout
- provider_stream_error
- provider_unknown

HTTP route 负责把 normalized error 转为下游协议错误形状：

- Anthropic：`{ type: "error", error: { type, message } }`
- OpenAI/Codex：`{ error: { message, type, code } }`

provider adapter 只负责把上游错误归一化，不决定下游状态码。

## 11. 测试策略

保留并加强现有测试层次：

- shared：IR、capabilities、descriptor 校验。
- domain：routing policy、candidate filtering、sticky fingerprint、quota window、breaker state。
- application：public model 创建事务、upstream onboarding、consumer key access、gateway orchestration。
- infrastructure：repository migration、SQLite constraint、provider auth decrypt。
- adapter contract：每个 provider adapter 的 request/response/error/usage 样例。
- API integration：Fastify inject 覆盖 admin routes 和 gateway routes。
- stream tests：首 token timeout、SSE usage、failover before commit。
- web tests：关键页面和 composable。
- e2e：登录、创建上游 key、创建模型、生成 consumer key、发起一次网关请求。

测试原则：

- 路由决策尽量纯函数化，单测覆盖主要组合。
- 对上游请求使用 fake upstream，不连真实供应商。
- 所有 secret/redaction 有专门回归测试。

## 12. 迁移实施阶段

建议分阶段在新分支重建，而不是一次性搬迁全部代码。

### Phase 0: 项目骨架

- 创建 monorepo 基础配置。
- 建立 shared contracts、domain、application、infrastructure、server 目录。
- 建立测试框架和 lint/typecheck。
- 写入本架构文档、产品决策文档和 API contract 草案。

### Phase 1: 数据层与核心领域

- 迁移 schema 和 migrations。
- 建 repository / unit-of-work。
- 迁移 normalized errors、ids、protocols、IR、capabilities、provider descriptor。
- 完成 auth、target、public model、model group、upstream 基础领域服务。

### Phase 2: 管理 API

- 实现管理员认证。
- 实现 upstream key、public model、model group、app、consumer key、settings API。
- 实现 Setup Wizard 后端支撑。
- 实现备份/恢复基础能力。
- 前端先实现最小管理路径。

### Phase 3: 网关非流式

- 实现 Consumer Key auth。
- 实现 Anthropic/OpenAI/Codex 非流式入口。
- 实现 RoutingDecisionService。
- 实现 provider adapters 和 upstream sender。
- 实现 usage/trace/quota/sticky/cooldown/breaker 基础副作用。

### Phase 4: 流式与韧性

- 实现 SSE 流式。
- 实现 first-token timeout failover。
- 完成 endpoint health、circuit breaker、group balancing、session sticky。

### Phase 5: 可观测与运维

- 完成 usage dashboard、trace detail、consumption stats、临时内容调试。
- 完成成本与套餐账本。
- 完成 maintenance jobs。
- 完成备份/恢复/升级策略 UI 与文档。

### Phase 6: 参考项目能力择优吸收

- 引入类似 cc-switch 的 query/composable 资源层。
- 引入更完整的 provider preset 表单体验。
- 引入备份和 schema upgrade 前保护机制。
- 评估是否需要导入/导出配置。

## 13. MVP 验收清单

第一版重构可被认为可用，需要满足：

- 管理员可登录并修改密码。
- 可创建 PAT 上游 key，选择 provider preset，发现模型并保存映射。
- 可创建公共模型和模型组。
- 可创建 App 和 Consumer Key，默认可访问全部模型，也可切换为受限授权。
- `GET /v1/models` 正确返回授权模型。
- `POST /v1/messages`、`POST /v1/chat/completions`、`POST /v1/responses` 非流式可路由。
- 至少 OpenAI-compatible 和 Anthropic-compatible adapter 通过 fake upstream 测试。
- 候选过滤包含 enabled/frozen/cooldown/quota/capability/protocol/breaker。
- 激进 failover 覆盖 auth/permission/model_not_found/bad_request 等错误，并在 trace 中可解释。
- sticky routing 默认参与路由，并在 trace 中记录命中/失效。
- usage、trace、audit 正常落库。
- 成本统计和套餐账本有首版 UI。
- 模型参考榜单可辅助生成配置建议。
- Setup Wizard 可完成首个 provider、模型、Consumer Key 和测试请求。
- 备份/恢复可用，支持完整数据库备份和非敏感配置导出。
- secret 不以明文落库，日志不泄露 key。
- `pnpm typecheck`、`pnpm test`、关键 e2e 通过。

## 14. 未决问题

这些问题需要在正式编码前确认：

- public endpoint base path 是否继续启动时读取，还是支持热更新路由。
- 内置模型参考榜单的固定来源选择。
- 本地自定义 provider preset 存 SQLite 还是单独 JSON。
- Docker 镜像的默认 volume 布局。
- 自动备份保留数量和手动备份保留策略的精确默认值。
- 临时内容调试模式的默认窗口：例如 30 分钟 / 100 条。
