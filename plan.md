# ModelHarbor 实现计划

> 本文档列出当前文档已描述但代码中尚未实现的功能，以及用户新提出的需求。按优先级和依赖关系分阶段执行。

---

## 阶段一：修正模型组初始化行为（文档一致化） ✅ 已完成

### 问题

`docs/plan.md` 明确描述：

> "No model groups are created automatically. When a new upstream key is added, its models are exposed as individual public models only. Administrators manually create groups and assign public models to them through the dashboard."
>
> "ModelGroup is administrator-defined and starts empty by default. It is not tied to any provider or vendor. The intended use is functional grouping — for example `coder`, `planner`, `write`, `fast`, `cheap`, `auto`."

当前代码 `apps/api/src/modules/admin/upstream-onboarding.ts` 在创建上游 key 时，自动创建以供应商名命名的模型组（如 `MiniMax`、`OpenCode Go`、`DeepSeek`），并将所有 public models 加入该组。这与文档描述直接矛盾。

### 目标

- 删除上游 key onboarding 时的自动模型组创建逻辑
- 只创建 public models 和 candidates，不创建 group
- 确保 dashboard 中模型组页面为空初始状态，由管理员手动创建
- 保留 `POST /api/admin/upstream-keys/discover-models` 和模型映射编辑功能

### 状态

已完成。`apps/api/src/modules/admin/upstream-onboarding.ts` 在 onboarding 时只生成 public models 和 public model candidates，`apps/web/src/pages/ModelGroups.vue` 已展示空状态引导。

### 涉及文件

| 文件                                                | 改动                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/api/src/modules/admin/upstream-onboarding.ts` | 删除 `onboardUpstreamKey` 和 `onboardUpstreamKeyWithMappings` 中的模型组创建逻辑 |
| `apps/api/src/modules/admin/upstream-keys.ts`       | 确认创建上游 key 的 API 不再调用 group 创建                                      |
| `apps/web/src/pages/ModelGroups.vue`                | 确保页面展示空状态，引导用户手动创建                                             |

### 验收标准

- 新创建上游 key 后，只生成 public models 和 candidates，不生成任何模型组
- 模型组列表初始为空
- 现有数据（已创建的供应商组）保留不动，不影响已有路由

---

## 阶段二：Provider Capabilities 路由过滤 ✅ 已完成

### 问题

`docs/provider-adapters.md` 描述：

> "Each adapter must declare capabilities so the router can filter incompatible candidates before sending traffic."

当前每个 adapter 已声明 `capabilities`（如 `supportsTools`, `supportsVision`, `supportsJsonMode` 等），`router/candidates.ts` 的 `filterCandidates` 也已根据请求内容过滤不兼容候选。

### 实现

- `packages/shared/src/capabilities.ts` 提供 `requiredCapabilities(rawRequest)` 与 `requestRequiresCapability(rawRequest, capability)`。
- `apps/api/src/modules/router/candidates.ts` 的 `filterCandidates` 在协议匹配前检查 `streaming` / `tools` / `toolChoice` / `vision` / `jsonMode` / `thinking`，不匹配时以 `capability_mismatch` 原因丢弃候选。
- `ResolvedCandidate` 强制携带 `capabilities`，所有 adapter 均已声明。

### 涉及文件

| 文件                                        | 改动                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `packages/shared/src/capabilities.ts`       | `requiredCapabilities` / `requestRequiresCapability`                 |
| `apps/api/src/modules/router/candidates.ts` | `filterCandidates` capabilities 检查，`capability_mismatch` 过滤原因 |
| `apps/api/test/router.test.ts`              | 新增 tools / vision / jsonMode / streaming / 纯文本测试              |
| `docs/provider-adapters.md`                 | capabilities 过滤说明已存在                                          |

### 验收标准

- ✅ 客户端请求包含 `tools` 时，不支持 `supportsTools` 的候选被过滤为 `capability_mismatch`
- ✅ 过滤后的候选列表中不再包含不支持的 upstream
- ✅ 纯文本请求行为不变
- ✅ 现有测试通过

---

## 阶段三：请求链路追踪系统（用户新需求）

### 问题

当前只有 `console.error` 日志和 `usage_records` 表记录最终结果。没有中间步骤的追踪，无法看到：

- 一次请求尝试了哪些候选（第1个失败、第2个成功）
- 候选被过滤掉的原因
- Sticky 是否命中
- 流式响应的开始/结束时间

### 目标

1. **新增 `request_trace_logs` 表**：记录每个请求的完整中间链路（30天自动清理）
2. **生成 `traceId`**：网关入口生成，返回给客户端（`X-Request-Trace-Id` 响应头），不向上游透传
3. **各步骤埋点**：request_start → auth → target_resolve → access → candidates_expand → candidates_filter → sticky_check → candidate_attempt → success/fail → cooldown → request_complete → stream_start → stream_end
4. **Admin API**：`GET /api/admin/usage/traces/:traceId` 返回链路时间线
5. **Dashboard**：Usage 页面增加"查看链路"按钮，链路详情页展示时间线

### 涉及文件

| 文件                                               | 改动                                           |
| -------------------------------------------------- | ---------------------------------------------- |
| `apps/api/src/modules/db/schema.ts`                | 新增 `requestTraceLogs` 表                     |
| `apps/api/src/modules/db/init.ts`                  | 新增 `request_trace_logs` 表创建语句           |
| `apps/api/src/modules/observability/trace-logs.ts` | 新建：traceId 生成、步骤写入、查询接口         |
| `apps/api/src/modules/gateway/handler.ts`          | 入口生成 traceId，各步骤调用 trace-logs        |
| `apps/api/src/modules/gateway/stream-handler.ts`   | 流式步骤埋点                                   |
| `apps/api/src/modules/router/candidates.ts`        | candidates_expand / candidates_filter 步骤埋点 |
| `apps/api/src/modules/sticky/index.ts`             | sticky_check / sticky_hit 步骤埋点             |
| `apps/api/src/modules/jobs/index.ts`               | 新增 trace 日志清理任务（30天）                |
| `apps/api/src/modules/admin/observability.ts`      | 新增 `GET /api/admin/usage/traces/:traceId`    |
| `apps/web/src/pages/Usage.vue`                     | 增加"查看链路"按钮                             |
| `apps/web/src/pages/TraceDetail.vue`               | 新建：链路详情时间线页面                       |

### 数据表设计

```sql
CREATE TABLE request_trace_logs (
  id TEXT PRIMARY KEY,
  request_trace_id TEXT NOT NULL,
  step TEXT NOT NULL,              -- request_start, auth_success, target_resolve, ...
  step_index INTEGER NOT NULL,
  app_id TEXT,
  consumer_key_id TEXT,
  requested_target_name TEXT,
  resolved_target_type TEXT,
  resolved_target_id TEXT,
  source_protocol TEXT,
  upstream_key_id TEXT,
  upstream_key_name TEXT,
  real_model_name TEXT,
  endpoint_protocol TEXT,
  filter_reason TEXT,              -- 候选被过滤原因
  accepted_count INTEGER,
  dropped_count INTEGER,
  fallback_count INTEGER,
  http_status INTEGER,
  error_category TEXT,
  error_code TEXT,
  error_message TEXT,
  attempt_order INTEGER,           -- 第几次尝试
  final_outcome TEXT,              -- success / error / filtered / cooldown
  latency_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX request_trace_logs_trace_id_idx ON request_trace_logs(request_trace_id);
CREATE INDEX request_trace_logs_created_at_idx ON request_trace_logs(created_at);
```

### 验收标准

- 每次请求生成唯一 traceId，返回在响应头 `X-Request-Trace-Id` 中
- 链路日志包含所有中间步骤，可通过 traceId 查询完整时间线
- 30天前的 trace 日志自动删除
- 上游请求头中**不**包含任何 ModelHarbor 特有的 trace ID
- Dashboard 可查看最近请求的链路详情

---

## 阶段四：每日消耗统计（用户新需求）

### 问题

当前只有 `usage_records` 逐条记录和 `upstream_key_counters` 配额计数器。没有按（供应商 + 模型 + 日期）维度的聚合统计，无法回答：

- "DeepSeek 国际的 `deepseek-v4-flash` 今天用了多少输入/输出 token？"
- "OpenCode Go 的 `deepseek-v4-flash` 和 MiniMax 的 `deepseek-v4-flash` 缓存命中率分别是多少？"

### 目标

1. **新增 `model_consumption_stats` 表**：按天聚合，按（upstreamKey + realModel）维度，永久保存
2. **自动更新**：每次请求成功后，增量更新当天统计
3. **Admin API**：`GET /api/admin/usage/consumption` 返回每日消耗统计
4. **Dashboard**：新增"消耗统计"页面或卡片

### 涉及文件

| 文件                                                      | 改动                                    |
| --------------------------------------------------------- | --------------------------------------- |
| `apps/api/src/modules/db/schema.ts`                       | 新增 `modelConsumptionStats` 表         |
| `apps/api/src/modules/db/init.ts`                         | 新增表创建语句                          |
| `apps/api/src/modules/observability/consumption-stats.ts` | 新建：upsert 逻辑、查询接口             |
| `apps/api/src/modules/gateway/handler.ts`                 | 请求成功后调用 consumption stats upsert |
| `apps/api/src/modules/gateway/stream-handler.ts`          | 流式请求成功后调用 upsert               |
| `apps/api/src/modules/admin/observability.ts`             | 新增 `GET /api/admin/usage/consumption` |
| `apps/web/src/pages/Usage.vue`                            | 新增消耗统计卡片/表格                   |

### 数据表设计

```sql
CREATE TABLE model_consumption_stats (
  id TEXT PRIMARY KEY,
  upstream_key_id TEXT NOT NULL,
  real_model_name TEXT NOT NULL,
  day_date TEXT NOT NULL,            -- YYYY-MM-DD
  request_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE(upstream_key_id, real_model_name, day_date)
);

CREATE INDEX model_consumption_stats_day_idx ON model_consumption_stats(day_date);
CREATE INDEX model_consumption_stats_upstream_idx ON model_consumption_stats(upstream_key_id, day_date);
```

### 验收标准

- 每次请求成功后自动更新对应 (upstream, model, day) 的统计
- 支持 `cache_read_tokens` 和 `cache_write_tokens`（Anthropic 风格）
- Dashboard 可查看按供应商和模型维度的每日消耗
- 数据永久保留（不自动清理）

---

## 阶段五：Usage Records 缓存 Token 字段（用户新需求）

### 问题

`usage_records` 表当前只有 `input_tokens`, `output_tokens`, `total_tokens`。Anthropic API 返回 `cache_read_input_tokens` 和 `cache_creation_input_tokens`，需要记录这些字段才能计算缓存效率。

### 目标

- 在 `usage_records` 表中增加 `cache_read_tokens` 和 `cache_write_tokens` 字段
- 在 provider adapters 中提取缓存 token（Anthropic 适配器优先）
- 在 usage 记录时写入这些字段
- 在 Dashboard 中展示缓存命中率

### 涉及文件

| 文件                                                     | 改动                                                      |
| -------------------------------------------------------- | --------------------------------------------------------- |
| `apps/api/src/modules/db/schema.ts`                      | `usageRecords` 增加 `cacheReadTokens`, `cacheWriteTokens` |
| `apps/api/src/modules/db/init.ts`                        | 增加 ALTER TABLE 迁移语句                                 |
| `apps/api/src/modules/providers/anthropic-compatible.ts` | `extractUsage` 提取缓存 token                             |
| `apps/api/src/modules/providers/openai-compatible.ts`    | 检查 OpenAI 的 `cached_tokens` 字段                       |
| `apps/api/src/modules/gateway/handler.ts`                | 记录 usage 时写入缓存字段                                 |
| `apps/api/src/modules/observability/usage-stats.ts`      | 聚合查询中加入缓存字段                                    |
| `apps/web/src/pages/Usage.vue`                           | 展示缓存命中率                                            |

### 验收标准

- Anthropic 请求成功时，`cache_read_tokens` 和 `cache_write_tokens` 正确写入 usage record
- Dashboard 展示缓存命中率（`cache_read / (cache_read + input)`）
- 现有行为不变，不支持缓存的 provider 这些字段为 null

---

## 阶段六：可选的内容日志开关（文档已描述）

### 问题

`docs/plan.md` 描述：

> "Default logging must store metadata and statistics only. Full prompt and response body logging should be optional and controlled by the administrator."

当前代码**完全不存储** prompt 和 completion 内容，也没有开关来控制。这是一个文档已描述但代码中完全未实现的功能。

### 目标

- 在 `admin_settings` 或环境变量中增加内容日志开关（默认关闭）
- 当开关打开时，记录 prompt 和 response 的摘要或完整内容
- 存储到单独的内容日志表（与 trace 日志分开，或作为 trace 日志的可选字段）
- 内容日志也受保留策略约束（如 7 天）
- 记录时进行敏感信息脱敏（redaction）

### 优先级

**低**。此功能非用户当前痛点，且有隐私合规风险。建议在其他阶段完成后再评估是否需要实现。

---

## 执行顺序建议

| 阶段                      | 优先级 | 依赖   | 预计工作量                         | 状态      |
| ------------------------- | ------ | ------ | ---------------------------------- | --------- |
| 阶段一：模型组默认空      | 🔴 高  | 无     | 小（修改 onboarding 逻辑）         | ✅ 已完成 |
| 阶段三：链路追踪          | 🔴 高  | 无     | 大（新增表 + 埋点 + API + 前端）   | ✅ 已完成 |
| 阶段四：每日消耗统计      | 🔴 高  | 阶段三 | 中（新增表 + upsert + API + 前端） | ✅ 已完成 |
| 阶段五：缓存 Token 字段   | 🟡 中  | 无     | 小（表字段 + adapter 提取）        | ✅ 已完成 |
| 阶段二：Capabilities 过滤 | 🟡 中  | 无     | 中（新增过滤逻辑 + 测试）          | ✅ 已完成 |
| 阶段六：内容日志开关      | 🟢 低  | 无     | 中（开关 + 表 + 脱敏 + 前端）      | ⏳ 待做   |

当前队列中靠前的待做项：

- ✅ `fusion-plan.md` 阶段七 7.4 Group 负载均衡已完成。
- ✅ 本文件阶段二 Capabilities 路由过滤已完成。
- 本文件阶段六内容日志开关（低优先级）。

---

## 附录：已同步的文档 vs 代码状态

以下文档中的描述与代码已一致，无需改动：

| 文档 / 功能                               | 状态                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `data-model.md` 表结构                    | ✅ 所有表已实现，含 `circuit_breakers`、`upstream_endpoint_health`、`request_trace_logs`、`model_consumption_stats` |
| `architecture.md` 错误类                  | ✅ 所有 9 个错误类已实现（@modelharbor/shared）                                                                     |
| `mvp.md` 里程碑                           | ✅ M1-M7 核心功能已实现                                                                                             |
| `provider-adapters.md` Adapter 接口       | ✅ 3 个 adapter 已实现                                                                                              |
| `plan.md` Quota 系统                      | ✅ 已实现                                                                                                           |
| `plan.md` Sticky 路由                     | ✅ 已实现                                                                                                           |
| `fusion-plan.md` 7.1 Circuit Breaker      | ✅ 已实现                                                                                                           |
| `fusion-plan.md` 7.2 多端点延迟探测       | ✅ 已实现                                                                                                           |
| `fusion-plan.md` 7.5 First-Token 超时切换 | ✅ 已实现                                                                                                           |
| `testing.md` 测试策略                     | ✅ 已有测试框架                                                                                                     |
