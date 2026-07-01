# Sub2API 借鉴清单

本文档系统记录从 Sub2API 项目中识别出的、对 ManageYourLLM 有参考价值的设计与实现。

> 来源项目：Sub2API（https://github.com/Wei-Shaw/sub2api）  
> 定位差异：Sub2API 是面向订阅配额分发的商业 AI API 平台（多租户、支付、分销、复杂调度）；ManageYourLLM 是个人自用的 LLM 网关。其商业逻辑和复杂多租户基础设施不在借鉴范围内，但其**网关热路径的工程技巧**（状态模型、调度、错误处理、监控）值得参考。

---

## 阅读范围

- 网关请求流：`backend/internal/service/gateway_service.go`、`openai_account_scheduler.go`、`proxy_service.go`
- 账号/渠道：`backend/internal/service/account_service.go`、`channel_service.go`
- API Key：`backend/internal/service/api_key_service.go`、`api_key_auth_cache*.go`
- 计费/用量：`backend/internal/service/billing_service.go`、`model_pricing_resolver.go`、`account_usage_service.go`
- 限流并发：`backend/internal/service/ratelimit_service.go`、`concurrency_service.go`
- 粘性会话：`backend/internal/service/anthropic_session.go`
- 错误处理：`backend/internal/service/proxy_fallback.go`、`error_passthrough_service.go`
- 监控：`backend/internal/service/channel_monitor_*.go`
- 可观测性：`backend/internal/service/dashboard_service.go`、`ops_service.go`

---

## 一期：v1 核心链路

一期只保留**对后续架构影响大**或**v1 闭环必须**的项。

### 1. 账号可调度性多维状态模型

- **来源文件**：`backend/internal/service/account_service.go`、`openai_account_scheduler.go`
- **借鉴内容**：
  - 不把账号状态简化为单一 `active`，而是多维度联合判断：
    - `active`：是否启用
    - `schedulable`：当前是否可调度
    - `expired`：是否过期
    - `overloaded`：是否过载
    - `rateLimited`：是否被限流
    - `tempUnschedulable`：临时不可调度（如 token 刷新窗口）
    - `quotaExhausted`：额度是否耗尽
- **落地方式**：
  - 扩展 ManageYourLLM 的 ProviderAccount / Endpoint / Candidate 状态：
    - `enabled`
    - `frozen`
    - `cooldownUntil`
    - `breakerState`
    - `tempUnschedulableUntil`（预留，用于 OAuth/token 刷新）
  - 在 `RoutingDecisionService.filterCandidates()` 中统一检查。

### 2. Sticky Session + 粘性逃逸

- **来源文件**：`backend/internal/service/gateway_service.go`、`openai_account_scheduler.go`、`anthropic_session.go`
- **借鉴内容**：
  - 通过 `sessionHash` 把同一会话钉到同一账号。
  - 粘性命中后仍做完整健康/配额/并发检查。
  - 当粘性账号错误率过高、TTFT 过高、并发槽满或不可调度时，允许**粘性逃逸**。
- **落地方式**：
  - ManageYourLLM 已有 sticky session（`routing_state` 表）。
  - 补充"粘性逃逸"：命中 sticky binding 后，若该 candidate 被过滤（cooldown/breaker/过载），继续尝试下一个 candidate，并记录 `sticky_escape` trace event。

### 3. 请求体改写链

- **来源文件**：`backend/internal/service/gateway_service.go`
- **借鉴内容**：
  - 转发前按顺序应用多层改写：模型名映射、system prompt 注入、cache_control 限制、thinking block 过滤、工具名重写。
  - 每层独立，便于扩展和测试。
- **落地方式**：
  - 把当前 `ProviderAdapter.buildRequest` 中的硬编码改写拆成 chain：
    - `ModelNameTransformer`
    - `SystemPromptTransformer`
    - `ToolNameTransformer`
    - `ThinkingBlockTransformer`
  - v1 阶段可先保持简单实现，但接口按 chain 设计。

### 4. 最佳 effort 可观测性

- **来源文件**：`backend/internal/service/usage_service.go`、`ops_service.go`、`gateway_service.go`
- **借鉴内容**：
  - 用量记录、错误记录、trace 记录都是 best-effort。
  - 记录失败不阻塞请求返回。
- **落地方式**：
  - 确保 `GatewaySideEffectsService` 所有操作失败都不抛回主流程。
  - 统一通过 callback 执行 side effects，callback 失败不影响上游响应。

### 5. 错误分类处理（与 litellm 互补）

- **来源文件**：`backend/internal/service/ratelimit_service.go`、`error_passthrough_service.go`
- **借鉴内容**：
  - 401：OAuth 临时不可调度；API Key 直接 disable。
  - 402/403：区分 workspace deactivated / credit exhausted / banned。
  - 429：读取 `retry-after` 或解析错误体中的等待时间。
  - 400/422/404 model not found：不冷却整个账号。
- **落地方式**：
  - 详见 `docs/litellm-lessons.md` 第 2、5 项。
  - Sub2API 补充：对 401 可标记 `tempUnschedulableUntil` 而非直接 disable。

### 6. 错误日志脱敏、截断、分级（与 litellm 互补）

- **来源文件**：`backend/internal/service/ops_service.go`、`backend/internal/util/logredact`
- **借鉴内容**：
  - 错误体存储前限制 20KB。
  - 用户只看自己的错误，admin 看全量。
  - 敏感信息（credentials、api keys）入库前 redact。
- **落地方式**：
  - 详见 `docs/litellm-lessons.md` 第 7 项。
  - Sub2API 补充：设置 trace/debug content 的存储大小上限（如 20KB）。

---

## 二期：观测排障增强

### 7. 运行时 Channel/Model 映射快照

- **来源文件**：`backend/internal/service/channel_service.go`
- **借鉴内容**：
  - 把 Channel 的模型映射、定价在内存中扁平化为 O(1) 查找表。
  - 支持通配符前缀匹配。
  - DB 错误时写入短 TTL 空缓存防击穿。
  - 平台严格隔离。
- **落地方式**：
  - 启动时或配置变更时构建内存快照：
    - `Model -> Candidate[]`
    - `Channel -> Model[]`
    - `ProviderType + realModelName -> PricingEntry`
  - 减少每次请求的 DB 查询。

### 8. API Key 认证快照 + 版本号

- **来源文件**：`backend/internal/service/api_key_auth_cache*.go`
- **借鉴内容**：
  - 认证快照只含必要字段，避免每次认证 join 多表。
  - 快照带 `Version`，schema 演进时自动回源。
  - L1/L2 缓存 + 负缓存 + TTL jitter。
  - IP 白名单规则创建时预编译 CIDR。
- **落地方式**：
  - 在认证插件中缓存 `ClientKeyRow` 快照，带版本号或更新时间戳。
  - Client Key 更新时使缓存失效。
  - v1 单实例 SQLite，进程内缓存即可。

### 9. 并发槽抽象

- **来源文件**：`backend/internal/service/concurrency_service.go`
- **借鉴内容**：
  - `AcquireResult{Acquired, ReleaseFunc}` 模式，defer 释放。
  - 槽满时返回 wait plan 而不是直接 429。
- **落地方式**：
  - 若未来需要限制单个 Provider Account 并发，引入此抽象。
  - 单实例可用内存 Map + Mutex 实现，不需要 Redis。

### 10. 定价解析链

- **来源文件**：`backend/internal/service/model_pricing_resolver.go`、`billing_service.go`
- **借鉴内容**：
  - 定价优先级：Channel 覆盖 > LiteLLM 全局 > Fallback 硬编码。
  - 支持 token 区间、按次、图片计费。
  - Fallback 价格按模型族维护。
- **落地方式**：
  - ManageYourLLM 优先级：用户自定义 > litellm 价格表 > 内置 fallback。
  - 扩展 `PricingEntry` 计费维度：input/output/cache/image/audio/reasoning。

### 11. 上游额度探测与本地缓存

- **来源文件**：`backend/internal/service/account_usage_service.go`
- **借鉴内容**：
  - 主动抓取上游账号剩余额度。
  - 失败时负缓存 1 分钟，防止 429 重试风暴。
- **落地方式**：
  - 二期在 Provider Account 页面显示"上游剩余额度"。
  - 只需要 per-ProviderAccount 探测 + 本地缓存。

### 12. 真实请求探测 endpoint 健康

- **来源文件**：`backend/internal/service/channel_monitor_service.go`、`channel_monitor_checker.go`
- **借鉴内容**：
  - 定期用真实请求 probe 各 provider endpoint。
  - Provider Adapter 表：每个 provider 实现 `buildPath/buildBody/buildHeaders/textPath`。
  - Challenge 校验：发送算术问题，校验返回文本，防止 200 空响应。
  - SSRF 安全 HTTP Client：使用 `safeDialContext` 防止内网探测。
- **落地方式**：
  - `ProbeService` 增加 capability probe：
    - provider adapter：buildPath/buildBody/buildHeaders/validateResponse。
    - challenge 验证。
    - SSRF 保护。

### 13. Dashboard 缓存双 TTL

- **来源文件**：`backend/internal/service/dashboard_service.go`
- **借鉴内容**：
  - `freshTTL`（15s）直接返回 + `cacheTTL`（30s）异步刷新。
  - 标记 `StatsStale` 让 UI 知道数据可能落后。
- **落地方式**：
  - Overview / Usage / Costs 统计查询使用内存缓存 + 异步刷新。

### 14. 错误日志查询模式

- **来源文件**：`backend/internal/service/ops_service.go`、`ops_dashboard.go`
- **借鉴内容**：
  - 支持 `auto` / `preagg` / `raw` 查询模式。
  - `auto` 模式下预聚合未就绪自动 fallback 到原始表。
- **落地方式**：
  - v1 直接用原始表查询；数据量大后引入预聚合表和查询模式降级。

### 15. 用量聚合与 Watermark

- **来源文件**：`backend/internal/service/ops_aggregation_service.go`
- **借鉴内容**：
  - 按时间窗口聚合用量，watermark 控制进度，幂等 upsert。
- **落地方式**：
  - 数据量增长后按小时/天预聚合。
  - SQLite 单实例可用定时任务实现。

---

## 三期：扩展能力 / 明确不借鉴

### 16. 复杂调度策略

- **来源文件**：`backend/internal/service/openai_account_scheduler.go`、`scheduler_shuffle_test.go`
- **内容**：Top-K + 加权随机、负载感知、错误率、TTFT、quota headroom 综合评分。
- **不借鉴原因**：v1/v2 优先保持用户排序决定 failover 的可解释性；未来可作为可选策略。

### 17. 多租户商业化概念

- **来源文件**：`backend/internal/service/payment_*.go`、`subscription_service.go`、`user_service.go`
- **内容**：用户余额、充值、退款、订阅计划、分销返利、按 key 配额。
- **不借鉴原因**：ManageYourLLM 明确不做充值、售卖、支付、分账、企业账单。

### 18. OAuth 账号池与 Token 刷新/反风控

- **来源文件**：`backend/internal/service/openai_oauth_service.go`、`claude_token_provider.go`、`gemini_oauth_service.go`、`tls_fingerprint_profile_service.go`
- **内容**：OAuth token 自动刷新、Claude Code 伪装、TLS 指纹、cyber policy。
- **不借鉴原因**：属于反 ToS 的灰产/风控对抗逻辑；ManageYourLLM 只支持标准 API Key。

### 19. 代理链式回退池

- **来源文件**：`backend/internal/service/proxy_service.go`、`proxy_fallback.go`
- **内容**：代理过期后链式找下一个可用代理，检测回退环。
- **不借鉴原因**：个人场景通常不需要代理池；若有需求在 Endpoint 级别配置单个 proxy 即可。

### 20. 用户级 RPM / 并发隔离

- **来源文件**：`backend/internal/service/ratelimit_service.go`、`user_group_rate_resolver.go`
- **内容**：按 user / group / key 维度限制 RPM、TPM、并发，基于消费额动态限流。
- **不借鉴原因**：v1 一个 Client 一个 active key，不做多租户隔离。

---

## 最推荐的最小借鉴集

> **"多维可调度性 + 粘性会话可逃逸 + 请求体改写链 + 最佳 effort 可观测性 + 错误分类不盲冷却"**

这一组合能显著提升个人网关的稳定性，同时不引入商业平台复杂度。
