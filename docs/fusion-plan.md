# ModelHarbor Reference 融合计划

> 基于 `reference/reports/` 对 **cc-switch、CodexBar、new-api、octopus** 四个项目的对比分析，制定本融合计划。目标是把与 ModelHarbor 定位一致的优秀能力，系统性地落地到代码中。
>
> - 本计划是 `plan.md` 的延续，新增 **阶段七 ~ 阶段十**。前置阶段（阶段一 ~ 阶段六）继续按 `plan.md` 执行。
> - 本计划中的所有任务都已在四份参考报告（`01-cc-switch.md`、`02-codexbar.md`、`03-new-api.md`、`04-octopus.md`）中详细论证；本文件只给出融合后的执行视图。

---

## 1. 目标与范围

### 1.1 融合目标

把参考项目中经过验证的设计模式、子系统和工程实践，转化为 ModelHarbor 的具体代码变更。重点补齐以下核心能力缺口：

1. **路由韧性**：Circuit Breaker、多端点延迟探测、Sticky Session、Group 负载均衡、First-Token 超时切换。
2. **Provider 生态**：Descriptor + 预设库、协议互转、自动价格/模型同步、缓存计费细分、字段裁剪、Auto-Ban。
3. **可观测与运维**：诊断导出、Statuspage 集成、实时日志 SSE、CLI 镜像、Health Badge。
4. **工程化**：原子写入、DTO 规则、错误 skipRetry 标记、任务热重载、多 DB 兼容布局。

### 1.2 不做清单（与产品定位冲突）

| 不做 | 原因 |
|------|------|
| 支付 / 充值 / 订阅 / 红包 / 兑换码 / 排行榜 | README 明确“不是转售平台” |
| WebAuthn / Passkey / OIDC / OAuth 提供商矩阵 | 当前 MVP 仅一个本地 admin |
| 桌面客户端功能（系统托盘、菜单栏、Keychain、浏览器 Cookie、Sparkle 自更新） | ModelHarbor 是服务端 Web 应用 |
| PWA / 离线 / 跨二进制自更新 | 服务端 npm 部署，不需要 |
| 异步媒体生成任务（Suno/Sora/视频） | 路线图上未包含 |
| 多前端主题 | 当前用户规模不值得 |

---

## 2. 融合原则

1. **Dashboard-first**：所有新增配置项都必须能在 Web 仪表盘上管理，不允许只通过配置文件或环境变量生效。
2. **服务层复用**：CLI、HTTP serve、诊断导出等入口必须复用现有 service 层，禁止复制业务逻辑。
3. **向后兼容**：已有表结构和 API 行为默认不变；新增字段必须可空或有合理默认值。
4. **可观测驱动**：阶段三（链路追踪）完成后，所有路由层改造必须能通过 traceId 衡量前后差异。
5. **单节点优先**：新增能力在单进程 SQLite 部署下必须可运行；Redis/Postgres 增强是可选扩展。

---

## 3. 与现有 `plan.md` 的衔接

| 现有阶段 | 状态 | 与本计划的关系 |
|----------|------|----------------|
| 阶段一：模型组默认空 | 进行中 | 前置，先完成 |
| 阶段二：Capabilities 路由过滤 | 待做 | 前置，阶段八协议互转依赖它 |
| 阶段三：请求链路追踪 | 已完成 | **关键前置**：CB、诊断导出、实时日志、First-Token 超时都依赖 trace 数据 |
| 阶段四：每日消耗统计 | 依赖阶段三 | 阶段八自动价格同步、P1 内存优先统计依赖它 |
| 阶段五：缓存 Token 字段 | 待做 | 阶段八 8.5 会进一步扩展为 1h/5m 区分 |
| 阶段六：内容日志开关 | 低优 | 与阶段九诊断导出可协同 |
| **阶段七：路由韧性融合** | **本计划新增** | 立即执行 |
| **阶段八：Provider 生态融合** | **本计划新增** | 阶段三、四、五完成后执行 |
| **阶段九：可观测与运维融合** | **本计划新增** | 阶段三完成后执行 |
| **阶段十：工程化与扩展性融合** | **本计划新增** | 穿插进行 |

---

## 4. 阶段七：路由韧性融合

> 来源：octopus（最直接）、cc-switch（Circuit Breaker 细节）。
> 目标：把路由层从“failover + cooldown”升级为具备 Circuit Breaker、延迟感知、Sticky Session、Group 负载均衡、First-Token 超时切换的韧性路由层。

### 7.1 Circuit Breaker（断路器）

- **落点**：`apps/api/src/modules/router/circuit-breaker.ts`
- **设计**：
  - 三态：`Closed` / `Open` / `HalfOpen`。
  - 颗粒度：`(upstreamKeyId, realModelName)`，与 octopus 对齐。
  - 触发：连续失败 >= 5 次；HalfOpen 成功 >= 2 次后关闭。
  - 指数退避：基础 60s，最大 600s，每次触发翻倍。
  - 与现有 cooldown 协同：CB Open 时直接跳过候选，同时触发 cooldown。
- **配置**：`admin_settings.circuit_breaker_enabled`（默认 true）、`failure_threshold`、`base_cooldown_ms`、`max_cooldown_ms`。
- **验收**：
  - 同一 (key, model) 连续失败 5 次后，第 6 次请求不再尝试该候选。
  - Open 状态持续期间，trace log 中标记 `circuit_breaker_open`。
  - HalfOpen 成功后恢复流量。

### 7.2 多端点延迟探测

- **落点**：`apps/api/src/modules/upstream/endpoint-health.ts`、`apps/api/src/modules/jobs/index.ts`
- **设计**：
  - `upstream_keys.endpoints` JSON 字段： `[{ url, delayMs, lastCheckedAt, enabled }]`。
  - 后台任务每小时对每个 endpoint 发 HEAD 请求探测延迟。
  - 路由时优先选择 delay 最小的 endpoint；若该 endpoint 在 cooldown/CB 中，则选下一个。
- **UI**：Upstream Keys 详情页展示 endpoint 延迟列表。
- **验收**：
  - 同一 upstream key 配置多个 endpoint 后，流量优先走延迟最低的可用 endpoint。
  - 最高延迟 endpoint 被标记为 degraded 时不被选中。

### 7.3 Sticky Session（短窗口粘性）

- **落点**：`apps/api/src/modules/router/sticky-session.ts`
- **设计**：
  - 绑定粒度：`(consumerKeyId, modelName) -> (upstreamKeyId, realModelName)`。
  - TTL：默认 5 分钟，可在 upstream key 级别配置。
  - 与现有对话级 Sticky 协同：对话级 Sticky 命中 → 跳过 Sticky Session。
  - 目的：减少跨 channel 切换开销，提高上游 cache 命中率。
- **验收**：
  - 同一 consumer key 在 5 分钟内重复请求同一模型，优先命中上次成功的 upstream key + real model。
  - 命中候选不可用时自动降级到普通路由。

### 7.4 Group 负载均衡模式

- **落点**：`apps/api/src/modules/router/group-balancer.ts`
- **设计**：
  - 在 `model_groups` 表新增 `load_balance_mode` 字段：`round_robin` / `random` / `failover` / `weighted`。
  - 当请求目标为 group 时，按 group 模式从候选中挑选：
    - `round_robin`：原子计数器轮询。
    - `random`：Fisher-Yates 洗牌。
    - `failover`：按 priority 升序。
    - `weighted`：`rand * weight / totalWeight`。
- **依赖**：阶段一（模型组默认空）完成后实施更顺。
- **验收**：
  - 创建 group 时可选择 load balance mode。
  - 不同 mode 下相同候选集合产生可预期的选中分布。

### 7.5 First-Token 超时切换

- **落点**：`apps/api/src/modules/gateway/stream-handler.ts`
- **设计**：
  - 流式请求启动后，首个 token 必须在 `first_token_timeout_ms`（默认 15s）内到达。
  - 超时后：标记当前候选失败（计入 CB）→ 尝试下一个候选 → 继续流式响应。
  - 只在 group 或多候选场景启用，避免单候选无限重试。
- **验收**：
  - 模拟上游延迟 20s 不返回首个 token，请求在 15s 后自动切换到备用候选。
  - trace log 中记录 `first_token_timeout` 事件和切换后的 candidate。

---

## 5. 阶段八：Provider 生态融合

> 来源：CodexBar（Descriptor）、cc-switch（协议互转 + 预设库）、octopus（自动价格/模型同步）、new-api（缓存计费、字段裁剪、Auto-Ban）。
> 目标：把 Provider 从“每个 adapter 一份 TS 文件”升级为“Descriptor + 预设库 + 协议互转 + 自动同步”的生态系统。

### 8.1 Provider Descriptor + 预设库重构

- **落点**：
  - `packages/shared/src/provider-registry/descriptor.ts`
  - `packages/shared/src/provider-registry/presets.ts`
  - `apps/api/src/modules/providers/registry.ts`
  - `apps/api/src/modules/providers/presets.ts`
- **设计**：
  - 定义统一 `ProviderDescriptor`：
    ```ts
    {
      id: string;
      metadata: { displayName, docsUrl, statusPageUrl, apiKeyUrl };
      branding: { icon?, color? };
      capabilities: { protocols[], supportsTools, supportsVision, supportsJsonMode, supportsThinking };
      authStrategy: { kind: 'apiKey' | 'oauth', fields: string[] };
      modelSyncUrl?: string;
      defaultModel?: string;
      modelExamples?: string[];
    }
    ```
  - 把现有 `providers/presets.ts` 中的离散预设迁移到 descriptor 格式。
  - Admin 添加 upstream key 时支持“从预设导入”，自动填充 baseUrl、协议、默认模型。
- **验收**：
  - 新增一个 provider 只需在 `presets.ts` 添加一份 descriptor，无需改 registry 核心代码。
  - “Add Key”页面可选择 preset，表单自动填充。

### 8.2 协议互转层

- **落点**：`packages/shared/src/protocol/converters/`、`apps/api/src/modules/gateway/handler.ts`
- **设计**：
  - 在 `packages/shared` 下建立协议转换子包，支持：
    - Anthropic Messages ↔ OpenAI Chat Completions
    - OpenAI Chat Completions ↔ OpenAI Responses
    - Anthropic ↔ Gemini Native（可选）
  - 先做非流式转换；流式转换作为后续迭代。
  - 转换入口统一为 `convertRequest(sourceProtocol, targetProtocol, ir)` 和 `convertResponse(...)`。
- **验收**：
  - 客户端用 OpenAI Chat 协议访问 Anthropic upstream 时，请求/响应正确互转。
  - 上游返回的错误也经过协议转换，保持客户端协议一致。

### 8.3 自动价格同步（models.dev）

- **落点**：
  - `apps/api/src/modules/observability/price-sync.ts`
  - `apps/api/src/modules/jobs/index.ts`
  - `packages/shared/src/price-presets.ts`（编译期兜底）
- **设计**：
  - 运行时：后台任务每 24h 拉取 `https://models.dev/api.json`，upsert 到 `model_prices` 表。
  - 编译期：脚本 `scripts/update-price.ts` 生成 `packages/shared/src/price-presets.ts` 作为离线兜底。
  - 表结构：`model_prices(model_name, input_price, output_price, cache_read_price, cache_write_price, source, updated_at)`。
  - Admin 覆盖：UI 上手动修改价格后，source 标记为 `manual`，不再被自动同步覆盖。
- **验收**：
  - 首次启动无网络时，能使用编译期价格预设。
  - 有网络时，价格每 24h 自动更新。
  - 手动修改的价格不会被自动同步覆盖。

### 8.4 自动模型列表同步

- **落点**：`apps/api/src/modules/upstream/model-sync.ts`、`apps/api/src/modules/jobs/index.ts`
- **设计**：
  - 沿用现有 `POST /api/admin/upstream-keys/discover-models` 逻辑，改为后台任务。
  - `upstream_keys.auto_sync_models: boolean` 字段控制是否自动同步。
  - 同步策略：新增模型自动加入 public models（标记为 `auto`）/ 30 天未使用模型标记 deprecated / 改名时保留旧名映射。
  - 支持 `match_regex` 过滤。
- **验收**：
  - 配置 `auto_sync_models=true` 后，后台任务自动发现新模型。
  - Dashboard 保留手动触发按钮。

### 8.5 缓存 Token 1h/5m 区分

- **落点**：
  - `apps/api/src/modules/db/schema.ts`
  - `apps/api/src/modules/providers/anthropic-compatible.ts`
  - `apps/api/src/modules/observability/consumption-stats.ts`
- **设计**：
  - 扩展阶段五：在 `usage_records` 和 `model_consumption_stats` 增加 `cache_creation_1h_tokens` 和 `cache_creation_5m_tokens`。
  - Anthropic adapter 提取 `cache_creation_input_tokens` 时，按消息中 `cache_control.ephemeral: { ttl: '1h' }` 区分。
  - Dashboard 展示 cache 命中率、1h/5m 占比。
- **验收**：
  - Anthropic 请求返回 cache 创建 token 时，能正确区分 1h 和 5m。
  - 每日消耗统计按 1h/5m 分别汇总。

### 8.6 StreamOptions 支持图

- **落点**：
  - `packages/shared/src/stream-support.ts`
  - `apps/api/src/modules/providers/types.ts`
  - `apps/api/src/modules/gateway/stream-handler.ts`
- **设计**：
  - 每个 adapter 声明 `supportsStreamUsage: boolean`。
  - 只有支持 `stream_options.include_usage` 的 upstream 才发送该字段。
  - 集中维护支持图，避免每个 adapter 单独判断。
- **验收**：
  - 对不支持 include_usage 的 upstream，网关不再发送该字段。
  - 支持图可在 Provider Descriptor 中配置。

### 8.7 字段裁剪

- **落点**：`apps/api/src/modules/gateway/strip-fields.ts`、`apps/api/src/modules/db/schema.ts`
- **设计**：
  - `admin_settings.disabled_fields` JSON 列，默认：
    ```json
    ["service_tier", "inference_geo", "speed", "safety_identifier", "stream_options.include_obfuscation"]
    ```
  - 发到上游前 deep-remove 黑名单字段。
  - 支持 per-upstream-key 覆盖。
- **验收**：
  - 客户端请求带 `service_tier: priority` 时，该字段不会到达上游。
  - Settings 页面可编辑全局黑名单。

### 8.8 自动禁用渠道（Auto-Ban）

- **落点**：`apps/api/src/modules/router/auto-ban.ts`、`apps/api/src/modules/jobs/index.ts`
- **设计**：
  - 关键字匹配上游错误内容，命中后自动禁用 upstream key：
    - `"credit balance too low"`
    - `"organization disabled"`
    - `"permission denied"`
    - `"account suspended"`
  - `upstream_keys` 增加 `disabled_reason`、`disabled_at` 字段。
  - 关键字列表可在 Settings 中配置。
  - 后台任务定期 ping 每个 key（用测试模型），失败也触发 ban。
- **验收**：
  - 模拟上游返回 `"credit balance too low"`，该 upstream key 自动 disabled。
  - UI 显示 “Auto-disabled” 标签和原因。

---

## 6. 阶段九：可观测与运维融合

> 来源：CodexBar（CLI、诊断导出、Statuspage）、octopus（实时日志 SSE、Heatmap、DB 导入导出）、new-api（限流）。
> 目标：增强 admin 排障、监控、自动化能力。

### 9.1 诊断导出（脱敏）

- **落点**：`apps/api/src/modules/admin/diagnose.ts`、`apps/web/src/pages/Diagnose.vue`
- **设计**：
  - `POST /api/admin/diagnose?output=zip`
  - 导出内容：
    - `config.json`：脱敏后的 admin settings、upstream keys（key 显示为 `sk-***1234`）。
    - `recent_traces.jsonl`：最近 100 条 trace log。
    - `error_log.jsonl`：最近错误。
    - `system_info.json`：版本、运行时间、Node 版本。
  - 默认不包含原始 key；可选 `--include-keys=false` 强制不包含。
- **验收**：
  - 导出 ZIP 中不出现完整 API key。
  - 导入到其他环境可用于问题复现（不含凭据）。

### 9.2 Statuspage 集成

- **落点**：`apps/api/src/modules/observability/status-page.ts`、`apps/web/src/pages/UpstreamKeys.vue`
- **设计**：
  - Provider Descriptor 中配置 `statusPageUrl`。
  - 后台任务每 5 分钟拉取 Statuspage.io `api/v2/status.json`，缓存到 `upstream_status` 表。
  - Upstream Keys 列表每行显示状态图标（healthy / degraded / down / unknown），hover 显示 incident 摘要。
- **验收**：
  - 配置 statusPageUrl 后，仪表盘能显示该 provider 的公开状态。

### 9.3 实时日志 SSE

- **落点**：`apps/api/src/modules/admin/observability.ts`、`apps/web/src/pages/TraceStream.vue`
- **设计**：
  - `GET /api/admin/usage/traces/stream`（SSE，admin 鉴权）。
  - 内部使用 EventEmitter，新 trace log 产生时推送给所有订阅连接。
  - 限流：单连接最多 1k 条/秒。
- **验收**：
  - 打开 Trace Stream 页面后，新请求实时出现在列表中。

### 9.4 Activity Heatmap

- **落点**：`apps/web/src/components/ActivityHeatmap.vue`、`apps/web/src/pages/Usage.vue`
- **设计**：
  - 54 周 × 7 天 GitHub-style 热力图。
  - 颜色按每日请求数映射：0 → 灰，1-10 → 浅绿，10-100 → 绿，>100 → 深绿。
  - 数据复用 `model_consumption_stats`。
- **验收**：
  - Usage 页面展示过去一年活跃度热力图。

### 9.5 CLI 镜像 API 行为

- **落点**：`apps/api/src/cli/` 或新包 `packages/cli/`
- **设计**：
  - 使用 `commander`。
  - 命令集（分阶段实现）：
    ```
    modelharbor upstreams list/add/update/delete/test
    modelharbor models list/sync
    modelharbor apps list/create/delete
    modelharbor consumer-keys create/list/revoke
    modelharbor usage --from=... --to=... --format=json
    modelharbor serve --port=9090      # 只读本地 HTTP
    modelharbor diagnose --output=zip
    modelharbor config set/get
    ```
  - 所有命令通过 service 层执行，不复制业务逻辑。
- **验收**：
  - `modelharbor upstreams list` 输出与 Dashboard 一致。
  - CLI 可独立运行，用于 CI/CD 自动化。

### 9.6 本地只读 HTTP Serve

- **落点**：`apps/api/src/cli/serve.ts`
- **设计**：
  - `modelharbor serve --port=9090` 绑定 `127.0.0.1`。
  - 端点：`/health`、`/v1/usage`、`/v1/upstreams/health`、`/v1/diagnose/summary`。
  - 只读，拒绝任何写操作。
  - 用途：本地监控、IDE 插件、Prometheus exporter。
- **验收**：
  - 只读端口无法修改配置。
  - 非 127.0.0.1 Host header 拒绝连接。

### 9.7 Provider Health Badge

- **落点**：`apps/api/src/modules/router/health-badge.ts`、`apps/web/src/pages/UpstreamKeys.vue`
- **设计**：
  - 后端 `/api/admin/upstream-keys` 列表接口增加 `health: { status, lastError, lastSuccessAt }`。
  - 状态来源：CB 状态、最近错误、延迟探测、Statuspage。
  - 前端用 Naive UI `n-tag` 展示（success / warning / error / default）。
- **验收**：
  - 连续失败的 upstream key 显示 error tag。
  - hover 显示最近一次错误信息。

### 9.8 限流（内存版）

- **落点**：`apps/api/src/modules/middleware/rate-limit.ts`
- **设计**：
  - 第一版使用内存令牌桶，避免引入 Redis 依赖。
  - 粒度：`(appId, modelName)` → RPM / TPM。
  - 触发后返回 429 + `Retry-After`。
  - 配置：`admin_settings.rate_limits` JSON。
- **验收**：
  - 超过 RPM 限制后请求被拒绝，响应头包含 `Retry-After`。

---

## 7. 阶段十：工程化与扩展性融合

> 来源：cc-switch（原子写入）、new-api（JSON 包装、DTO 规则、skipRetry、多 DB 兼容）、octopus（后台任务热重载、sharded cache）。
> 目标：提升代码质量、可维护性和未来扩展空间。

### 10.1 原子文件写入

- **落点**：`apps/api/src/utils/atomic-write.ts`
- **设计**：
  - `tmp + fsync + rename` 模式；Windows 下先删除目标文件再 rename。
  - 用于：配置导出/导入、JSON/YAML 配置文件写入。
- **验收**：
  - 写入过程中进程崩溃，目标文件保持完整或为空，不出现半截文件。

### 10.2 JSON 包装与 DTO 字段规则

- **落点**：
  - `packages/shared/src/json.ts`
  - ESLint 规则（可选）
- **设计**：
  - 统一 `marshal` / `unmarshal` / `decodeJson` 包装。
  - 转发 DTO 中 number / boolean 字段使用 `T | undefined` 或 Zod optional，避免显式 0 被省略。
- **验收**：
  - 新代码使用包装函数；`temperature: 0` 能正确转发到上游。

### 10.3 错误 skipRetry 标记

- **落点**：`packages/shared/src/errors.ts`、`apps/api/src/modules/router/candidates.ts`
- **设计**：
  - 每个错误类增加 `skipRetry: boolean` 字段。
  - 分类：
    - `AuthError`、`PermissionError`、`BadRequestError` → `skipRetry: true`
    - `RateLimitError`、`TimeoutError` → `skipRetry: false`
  - router 重试逻辑读取该标记。
- **验收**：
  - 上游返回 401 时，不再尝试其他候选，立即返回错误。

### 10.4 后台任务热重载

- **落点**：`apps/api/src/modules/jobs/manager.ts`
- **设计**：
  - 所有后台任务支持 `updateInterval(taskName, duration)`。
  - Admin UI 可调整价格同步、模型同步、延迟探测、trace 清理等任务间隔。
- **验收**：
  - 修改任务间隔后无需重启即可生效。

### 10.5 多数据库兼容布局

- **落点**：`apps/api/src/modules/db/schema.ts`、所有迁移文件
- **设计**：
  - 当前不切换数据库，但避免 SQLite-only 类型：
    - JSON 用 `TEXT` 存，不用 `JSONB`。
    - boolean 用 `integer`（0/1），兼容 Drizzle 的 SQLite 默认行为。
    - 任何新 migration 都先验证“换成 PostgreSQL 是否成立”。
- **验收**：
  - 新 migration 通过代码审查时包含 PG 兼容性说明。

### 10.6 Sharded In-Memory Cache

- **落点**：`packages/shared/src/cache.ts`
- **设计**：
  - 16 分片 + xxhash 路由的并发 map。
  - 替换现有单 Map 缓存，用于 upstream keys、models、consumer keys 等热路径。
- **验收**：
  - 缓存读写性能在高并发下稳定，锁竞争降低。

---

## 8. 执行顺序与依赖

```
[阶段一] 模型组默认空
   |
[阶段二] Capabilities 过滤
   |
[阶段三] 链路追踪系统  ─────────────────────────────┐
   │                                                │
[阶段四] 每日消耗统计                              │
   │                                                │
[阶段五] 缓存 Token 字段                           │
   │                                                │
[阶段七] 路由韧性融合                              │
   ├── 7.1 Circuit Breaker                          │
   ├── 7.2 多端点延迟探测                           │
   ├── 7.3 Sticky Session                           │
   ├── 7.4 Group 负载均衡                           │
   └── 7.5 First-Token 超时切换                     │
   │                                                │
[阶段八] Provider 生态融合                         │
   ├── 8.1 Provider Descriptor + 预设库             │
   ├── 8.2 协议互转                                 │
   ├── 8.3 自动价格同步                             │
   ├── 8.4 自动模型同步                             │
   ├── 8.5 缓存 Token 1h/5m 区分                    │
   ├── 8.6 StreamOptions 支持图                     │
   ├── 8.7 字段裁剪                                 │
   └── 8.8 自动禁用渠道                             │
   │                                                │
[阶段九] 可观测与运维融合                          │
   ├── 9.1 诊断导出                                 │
   ├── 9.2 Statuspage 集成                          │
   ├── 9.3 实时日志 SSE                             │
   ├── 9.4 Activity Heatmap                         │
   ├── 9.5 CLI 镜像                                 │
   ├── 9.6 本地只读 Serve                           │
   ├── 9.7 Provider Health Badge                    │
   └── 9.8 限流（内存版）                           │
   │                                                │
[阶段十] 工程化与扩展性融合（可与上述阶段穿插）    │
   ├── 10.1 原子写入                                │
   ├── 10.2 JSON 包装 / DTO 规则                    │
   ├── 10.3 错误 skipRetry                          │
   ├── 10.4 任务热重载                              │
   ├── 10.5 多 DB 兼容布局                          │
   └── 10.6 Sharded Cache                           │
```

**关键依赖说明**：
- 阶段三（链路追踪）是阶段七、八、九中多数任务的**前置**，因为 CB、First-Token、诊断导出、实时日志、字段裁剪验证都依赖 trace 数据。
- 阶段四（每日消耗统计）是 8.3 价格同步、8.5 缓存 1h/5m 区分的**前置**。
- 阶段五（缓存 Token 字段）是 8.5 缓存 1h/5m 区分的**前置**。
- 阶段二（Capabilities 过滤）是 8.2 协议互转的**前置**，因为协议互转后必须按能力过滤候选。

---

## 9. 工作量与资源估算

| 阶段 | 任务数 | 预计总工作量 | 关键路径 |
|------|--------|--------------|----------|
| 阶段七：路由韧性 | 5 | 4 ~ 5 周 | Circuit Breaker → 延迟探测 → First-Token |
| 阶段八：Provider 生态 | 8 | 6 ~ 8 周 | Descriptor → 协议互转 → 价格/模型同步 |
| 阶段九：可观测与运维 | 8 | 5 ~ 6 周 | 诊断导出 → CLI → 实时日志 SSE |
| 阶段十：工程化 | 6 | 2 ~ 3 周 | 可穿插 |
| **合计** | **27** | **17 ~ 22 周** | 按 1 名全栈工程师估算 |

> 注：工作量按单人全职估算。若分模块并行（路由、Provider、可观测各一人），核心路径可压缩至 8 ~ 10 周。

---

## 10. 验收标准汇总

| 验收项 | 标准 |
|--------|------|
| 功能正确性 | 每个任务都有对应的单元测试或 e2e 测试覆盖 |
| 向后兼容 | 现有 API 和数据库行为默认不变；新增字段可空或有默认值 |
| 可观测 | 每个路由层改造都能在 trace log 中体现 |
| 安全 | 诊断导出、CLI、本地 serve 不泄露原始 key；字段裁剪生效 |
| 性能 | CB / 限流 / sharded cache 不引入明显延迟（p99 < 5ms） |
| 文档 | 每个阶段完成后更新 `docs/provider-adapters.md`、`docs/api-contract.md`、`docs/operations.md` |

---

## 11. 维护约定

1. **计划更新**：每完成一个阶段，回顾实际工作量与预估差异，更新本文件中的工作量与依赖。
2. **参考报告同步**：如果 reference 项目发布新版本并引入值得借鉴的能力，应在 `.learnings/FEATURE_REQUESTS.md` 中记录，并评估是否纳入本计划的下一次迭代。
3. **不做清单坚守**：任何新增需求如果落入“不做清单”，必须在 `docs/decisions.md` 中记录决策理由。

---

*制定依据：`reference/reports/00-summary.md` 及四份子报告。*
*适用范围：ModelHarbor 后端（`apps/api`）、前端（`apps/web`）、共享包（`packages/shared`）。*
