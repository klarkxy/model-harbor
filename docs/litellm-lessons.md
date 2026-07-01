# LiteLLM 借鉴清单

本文档系统记录从 LiteLLM 项目中识别出的、对 ManageYourLLM 有参考价值的设计与实现。

> 来源项目：LiteLLM（https://github.com/BerriAI/litellm）  
> License：MIT  
> Copyright：(c) 2023 Berri AI

---

## 关于 LiteLLM Router 系统

LiteLLM 的核心是它的 **Router / 路由系统**，包含 `simple_shuffle`、`least_busy`、`lowest_latency`、`lowest_cost`、`lowest_tpm_rpm`、`quality_router`、`complexity_router`、`adaptive_router`、`tag_based_routing`、`budget_limiter` 等策略，以及 fallback、pattern match、cooldown、health state 等基础设施。

ManageYourLLM v1 明确只做**顺序 failover**，但架构上必须为后续策略预留扩展点：

1. **Routing Strategy 接口**：v1 实现 `SequentialRoutingStrategy`，未来可注入 `LatencyRoutingStrategy`、`CostRoutingStrategy` 等。
2. **Candidate Score 接口**：即使 v1 不排序，也让 candidate 可携带 `score`。
3. **Candidate 级指标收集**：v1 就记录 latency、TTFT、RPM、TPM、error rate，存入 SQLite，为后续策略提供数据。
4. **Routing Context 对象**：把请求上下文封装成 `RoutingContext`，策略只接收 `RoutingContext + CandidateSnapshot[]`。
5. **策略配置持久化**：`Settings` 表预留 `routingStrategy` 和 `routingStrategyConfig` 字段。

详细路由能力分析见本文末尾"三期：复杂路由策略"。

---

## 一期：v1 核心链路

v1 核心链路：Provider Account -> Endpoint -> Model/Channel -> Client -> 网关请求 -> Usage/Trace/Cost -> Backup。

一期只保留**必须落地**或**现在不做后面很难改**的项。

### 1. 模型定价与能力数据

- **来源文件**：`litellm/model_prices_and_context_window.json`
- **已落地位置**：
  - `apps/api/data/model-prices.json`
  - `apps/api/data/model-prices.json.LICENSE`
- **借鉴内容**：模型单价、上下文窗口、能力标志（vision / function calling / reasoning 等）。
- **落地方式**：作为 `PricingEntry` 和 `ModelReference` 的 seed 数据，用户可覆盖。

### 2. 错误分类与归一化

- **来源文件**：`litellm/litellm_core_utils/exception_mapping_utils.py`、`litellm/exceptions.py`
- **借鉴内容**：
  - 基于 HTTP status + 错误字符串关键词分类异常。
  - 标准异常类型：`RateLimitError`、`Timeout`、`AuthenticationError`、`BadRequestError`、`ContextWindowExceededError`、`ContentPolicyViolationError`、`InternalServerError`、`ServiceUnavailableError`。
- **落地方式**：
  - 新增 `ProviderContextWindowExceededError`、`ProviderContentPolicyError`。
  - 这两类错误**不再 failover**，也**不计入 cooldown/breaker**。

### 3. Cooldown 时长算法

- **来源文件**：`litellm/litellm/utils.py` 的 `_calculate_retry_after()`
- **来源常量**：`litellm/constants.py` 的 `INITIAL_RETRY_DELAY = 0.5`、`MAX_RETRY_DELAY = 8.0`、`JITTER = 0.75`
- **借鉴内容**：
  - 优先使用 `Retry-After` header。
  - 否则指数退避：`INITIAL_RETRY_DELAY * 2^num_retries`。
  - 加 jitter，上限 `MAX_RETRY_DELAY`。
- **落地方式**：替换固定 cooldown 时长，根据错误类型和失败次数动态计算 `cooldownUntil`。

### 4. Cooldown 触发条件与失败率阈值

- **来源文件**：`litellm/router_utils/cooldown_handlers.py`
- **借鉴内容**：
  - 429/401/408/404 触发 cooldown；其他 4xx 不触发。
  - 5xx 及网络错误触发 cooldown。
  - 单 deployment 在 1 分钟内失败率超过 50% 且请求数超过 5 次才触发冷却。
- **落地方式**：细化 `isRetriableFailure()`，避免首次失败就冷却整个 candidate。

### 5. 错误类型 -> 路由行为映射

- **来源文件**：`litellm/litellm/types/router.py` 的 `RetryPolicy`
- **借鉴内容**：按异常类型决定 failover / cooldown 行为。
- **落地方式**：在代码中建立内部映射表：

| 错误类型 | failover | cooldown |
|---|---|---|
| ContextWindowExceededError | 否 | 否 |
| ContentPolicyViolationError | 否 | 否 |
| ProviderBadRequestError | 是 | 否 |
| ProviderAuthError | 是 | 否 |
| ProviderModelNotFoundError | 是 | 否 |
| ProviderRateLimitError | 是 | 是 |
| ProviderQuotaError | 是 | 是 |
| ProviderOverloadedError | 是 | 是 |
| ProviderTimeoutError | 是 | 是 |
| 5xx / ProviderError | 是 | 是 |

### 6. Provider Adapter 架构（为后续扩展预留）

- **来源文件**：`litellm/ARCHITECTURE.md`、`litellm/llms/{provider}/chat/transformation.py`
- **借鉴内容**：每个 provider 一个 `transformation.py`，实现 `transform_request()` / `transform_response()`。
- **落地方式**：
  - v1 保留 `OpenAICompatibleAdapter` / `AnthropicCompatibleAdapter`。
  - 在 `ProviderPreset` / `Endpoint` 中预留 `transformationHints` 字段，逐步把硬编码差异抽离。

### 7. Secret Redaction 字段清单与算法

- **来源文件**：`litellm/litellm_core_utils/sensitive_data_masker.py`
- **借鉴内容**：
  - 敏感模式：`password`、`secret`、`key`、`token`、`auth`、`authorization`、`credential`、`access`、`private`、`certificate`。
  - 非敏感覆盖词：`cost`（避免 `input_cost_per_token` 被误脱敏）。
  - 按 key segment 匹配，部分遮蔽（前缀 4 位 + 后缀 4 位）。
- **落地方式**：增强 `content-log-redaction.ts`，实现 `SensitiveDataMasker` 类，用于 trace / debug content / backup 导出。

### 8. Logging Object / Callback Manager（为后续路由策略预留）

- **来源文件**：`litellm/litellm_core_utils/litellm_logging.py`、`logging_callback_manager.py`
- **借鉴内容**：一次请求对应统一 `logging_obj`，回调在 pre-call / success / failure 时触发。
- **落地方式**：
  - 抽象 `GatewayLogContext`，贯穿 routing / attempt / side effects。
  - 把 Usage/Trace/Cost 实现为内置 callback，为未来 webhook / 路由策略指标收集预留接口。

---

## 二期：观测排障增强

二期在 v1 跑通后落地，提升可观测性、健康检查和路由准确性。

### 9. Provider Endpoint 支持矩阵

- **来源文件**：`litellm/provider_endpoints_support_backup.json`
- **借鉴内容**：每个 provider 支持哪些 endpoint（chat_completions、messages、responses、embeddings 等）。
- **落地方式**：复制为 `apps/api/data/provider-endpoints-support.json`（带 LICENSE），用于 Provider Preset 默认 endpoint 生成。

### 10. 默认值常量

- **来源文件**：`litellm/constants.py`
- **借鉴内容**：`DEFAULT_MAX_RETRIES`、`DEFAULT_COOLDOWN_TIME_SECONDS`、`DEFAULT_FAILURE_THRESHOLD_PERCENT`、`DEFAULT_FAILURE_THRESHOLD_MINIMUM_REQUESTS`、`MAX_BASE64_LENGTH_FOR_LOGGING`、`MAX_IMAGE_URL_DOWNLOAD_SIZE_MB`。
- **落地方式**：在 `SettingsService` 默认值中参考。

### 11. Cooldown Cache 数据结构

- **来源文件**：`litellm/router_utils/cooldown_cache.py`
- **借鉴内容**：结构化存储 cooldown 记录（exception、status_code、timestamp、cooldown_time），TTL 自动过期，批量查询。
- **落地方式**：优化 `RoutingStateRepository` 的 cooldown 表结构和查询。

### 12. 支持的 OpenAI 参数列表

- **来源文件**：`litellm/litellm_core_utils/get_supported_openai_params.py`
- **借鉴内容**：每个 provider/model 返回支持的 OpenAI-compatible 参数。
- **落地方式**：在 `ProviderPreset` 内置参数列表，路由前过滤不支持的参数。

### 13. Timeout 层级解析

- **来源文件**：`litellm/router.py` 的 `_get_stream_timeout()`
- **借鉴内容**：timeout 优先级：endpoint > router-level > default。
- **落地方式**：`Endpoint` 表增加 `timeoutMs` / `firstTokenTimeoutMs`，覆盖全局设置。

### 14. 响应耗时详情 Header

- **来源文件**：`litellm/litellm_core_utils/response_header_helpers.py`
- **借鉴内容**：响应头中加入各阶段耗时。
- **落地方式**：增加 `x-myllm-target-resolve-ms`、`x-myllm-routing-decision-ms`、`x-myllm-upstream-latency-ms`、`x-myllm-attempt-count`。

### 15. At-Rest 加密版本化

- **来源文件**：`litellm/proxy/common_utils/encrypt_decrypt_utils.py`
- **借鉴内容**：AES-256-GCM / XSalsa20-Poly1305 双算法，版本前缀 `v2:gcm:`，读时自动检测。
- **落地方式**：评估当前 `secret-crypto.ts`，若单一算法可借鉴版本化前缀设计。

### 16. Model Listing：Public / Internal 名称映射

- **来源文件**：`litellm/proxy/common_utils/model_listing_utils.py`
- **借鉴内容**：`/v1/models` 返回 public name，内部路由用 internal key，first-wins 去重。
- **落地方式**：确保 `/v1/models` 列表和 `GET /v1/models/{id}` 解析一致。

### 17. Failover 信息响应头

- **来源文件**：`litellm/router_utils/add_retry_fallback_headers.py`
- **借鉴内容**：fallback 后在响应头暴露尝试次数、最终 deployment。
- **落地方式**：增加 `x-myllm-attempt-count`、`x-myllm-final-provider-account-id`、`x-myllm-final-endpoint-id`、`x-myllm-final-real-model-name`。

### 18. Request Body 解析限制

- **来源文件**：`litellm/constants.py` 的 `MAX_REQUEST_BODY_SIZE_TO_REPAIR_MB`
- **借鉴内容**：对畸形请求体修复设置大小上限，避免阻塞事件循环。
- **落地方式**：Fastify 设置 body size limit，大请求体 parse 失败直接 400。

### 19. Callback 驱动的指标收集

- **来源文件**：`litellm/router_strategy/lowest_latency.py`、`least_busy.py`、`lowest_cost.py`
- **借鉴内容**：路由策略通过 `CustomLogger` callback 收集 latency、TTFT、TPM、RPM、cost。
- **落地方式**：抽象 `GatewayCallback` 接口（onRequestStart / onRequestSuccess / onRequestFailure），当前 Usage/Trace/Cost 作为内置 callback。

### 20. Candidate 级指标存储（滑动窗口）

- **来源文件**：`litellm/router_strategy/lowest_latency.py`、`least_busy.py`
- **借鉴内容**：每个 candidate 维护 latency、TTFT、RPM、TPM、cost 的滑动窗口。
- **落地方式**：存入 SQLite，用于 Trace 和 Overview，**不参与路由排序**。

### 21. 背景健康检查与 Health State Cache

- **来源文件**：`litellm/router_utils/health_state_cache.py`
- **借鉴内容**：定期 background probe，结果缓存并带 staleness 过期，路由时跳过 unhealthy deployment。
- **落地方式**：`endpoint-health-worker` 定期 probe，结果写入 `endpoint_health`，`RoutingDecisionService` 读取过滤。

### 22. Probe：用真实 completion 验证 endpoint

- **来源文件**：`litellm/scripts/health_check/health_check_client_README.md`
- **借鉴内容**：用真实 test prompt 验证 endpoint 能力，而不是只 ping。
- **落地方式**：`ProbeService` 增加 capability probe，区分 liveness 和 capability。

### 23. Context Window 预校验

- **来源文件**：`litellm/router.py`、`litellm/litellm_core_utils/token_counter.py`
- **借鉴内容**：路由前用 `max_input_tokens` 过滤装不下的 candidate，自动调整 `max_tokens`。
- **落地方式**：接入 tokenizer 后在 `RoutingDecisionService` 中增加基于 token 数量的预过滤。

### 24. Tokenizer 支持

- **来源文件**：`litellm/litellm_core_utils/token_counter.py`
- **借鉴内容**：tiktoken 集成、image token 估算、base64/URL 图片尺寸读取。
- **落地方式**：二期引入 tokenizer，用于 context window 校验和成本预估。

### 25. 图片 URL 下载限制与 base64 截断

- **来源文件**：`litellm/constants.py`、`litellm/litellm_core_utils/token_counter.py`
- **借鉴内容**：`MAX_IMAGE_URL_DOWNLOAD_SIZE_MB = 50`、`MAX_BASE64_LENGTH_FOR_LOGGING = 64`。
- **落地方式**：图片 URL 下载限制、日志中 base64 data URI 截断。

### 26. Logging Callback Integrations

- **来源文件**：`litellm/integrations/`
- **借鉴内容**：统一 callback 接口，可接入 Langfuse、OpenTelemetry、Datadog 等。
- **落地方式**：允许用户配置 webhook URL，每次请求后推送标准化 payload。

### 27. Health Endpoint 命名

- **来源文件**：`litellm/proxy/health_endpoints/_health_endpoints.py`
- **借鉴内容**：`/health/liveliness`、`/health/readiness`。
- **落地方式**：保留当前 `/healthz`、`/readyz`，或增加 `/health/liveness`、`/health/readiness` 别名。

---

## 三期：扩展能力

三期为 v1 之后的长期方向，只做记录，不投入实现。

### 28. 复杂路由策略

- **来源文件**：`litellm/router_strategy/`
- **内容**：`least_busy`、`lowest_latency`、`lowest_cost`、`lowest_tpm_rpm`、`quality_router`、`complexity_router`、`adaptive_router`、`tag_based_routing`。
- **落地条件**：当 candidate 级指标积累足够、用户有排序之外的需求时引入，默认仍为顺序 failover。

### 29. Semantic Caching

- **来源文件**：`litellm/caching/`、`helm values 中的 semanticCache`
- **内容**：embedding + vector store 缓存相似请求。
- **落地条件**：需要引入 embedding 和向量存储，改变单 SQLite 部署形态。

### 30. Per-Provider 成本计算

- **来源文件**：`litellm/cost_calculator.py`、`litellm/llms/{provider}/cost_calculation.py`
- **内容**：image token、audio token、reasoning token、cache discount 差异化计费。
- **落地条件**：`PricingEntry` schema 预留字段，实际计算按需扩展。

### 31. Guardrails / Prompt Management / Skills

- **来源文件**：`litellm/llms/litellm_proxy/skills/`、`litellm/policy_templates_backup.json`
- **内容**：skills injection、PII 模板、内容策略。
- **落地条件**：v2 评估，会显著增加复杂度。

### 32. Batch Processing

- **来源文件**：`litellm/batches/`
- **内容**：异步批量任务提交、状态轮询。
- **落地条件**：未来支持 OpenAI/Anthropic batch API 时参考。

### 33. Realtime API

- **来源文件**：`litellm/realtime_api/`
- **内容**：WebSocket 代理。
- **落地条件**：单独设计 WebSocket 网关。

### 34. RAG / Vector Store / Search

- **来源文件**：`litellm/rag/`、`litellm/llms/{provider}/vector_stores/`
- **内容**：向量存储、文件、搜索 endpoint 适配。
- **落地条件**：ManageYourLLM 定位是 LLM 网关，不是 RAG 平台。

### 35. MCP / A2A Agent Protocol

- **来源文件**：`litellm/a2a_protocol/`、`litellm/mcp_tools.py`
- **内容**：A2A、MCP 工具注册与调用。
- **落地条件**：远期扩展点，会改变产品边界。

### 36. Wildcard / Pattern 路由

- **来源文件**：`litellm/router_utils/pattern_match_deployments.py`
- **内容**：`openai/*`、`gpt-4*` 等 wildcard 路由，pattern specificity 排序。
- **落地条件**：未来 Channel/Model 支持通配符匹配时参考。

### 37. Budget Limiter 时间窗口累计

- **来源文件**：`litellm/router_strategy/budget_limiter.py`
- **内容**：按 key/team/user/model 维度预算拦截。
- **落地条件**：ManageYourLLM 的 Costs 模块未来可反向影响路由 score。

---

## 附录：已落地项

| 项 | 来源 | 落地位置 | 状态 |
|---|---|---|---|
| 模型定价与能力数据 | `litellm/model_prices_and_context_window.json` | `apps/api/data/model-prices.json` + `.LICENSE` | 已落地 |
