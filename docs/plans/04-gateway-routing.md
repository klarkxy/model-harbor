# 04 Gateway Routing

Phase 3 实现非流式网关。目标是通过 fake upstream 完成 Anthropic Messages、OpenAI Chat Completions、OpenAI Responses 三类请求，并把路由过程完整写入 trace。

## 目标

- Consumer Key 网关认证。
- Client wire request -> IR。
- RoutingDecisionService。
- Provider adapter。
- Upstream sender。
- 激进 failover。
- usage / trace / quota / sticky / breaker 副作用基础。
- 非流式响应映射。

## Gateway endpoints

- `GET /v1/models`
- `POST /v1/messages`
- `POST /v1/chat/completions`
- `POST /v1/responses`

`/v1` base path 未来可配置，但首版可以启动时读取。

## RoutingDecisionService

输入：

- app id
- consumer key id
- requested model
- source protocol
- IR
- raw request
- now

输出：

- resolved target
- accepted candidates
- dropped candidates with reason
- fallback candidates
- sticky/session sticky result
- trace events

过滤：

1. candidate enabled
2. public model enabled
3. upstream enabled
4. upstream not frozen
5. cooldown expired
6. quota not exceeded
7. circuit breaker allows
8. capabilities match
9. protocol match or fallback

## Provider adapters

首版必须实现：

- OpenAI-compatible。
- Anthropic-compatible。
- OpenAI Responses compatible path。

不做：

- Codex OAuth。
- Coze OAuth。
- 真实供应商 SDK。

## Failover

- 所有上游错误都可继续尝试后续候选。
- 每请求有最大尝试数。
- 每次失败写 trace。
- 最终错误应包含可解释摘要。

## 任务清单

1. 实现 gateway auth guard。
2. 实现 `/v1/models`。
3. 实现 request parsers：Anthropic、OpenAI Chat、OpenAI Responses。
4. 实现 IR。
5. 实现 RoutingDecisionService。
6. 实现 provider adapter 接口和两个核心 adapter。
7. 实现 upstream sender。
8. 实现 GatewayExecutionService。
9. 实现 GatewaySideEffects。
10. 实现 usage、trace、quota、sticky、breaker 基础写入。
11. 实现 fake upstream tests。

## 验收标准

- Consumer Key `accessMode = all` 可访问所有 public model / model group。
- `accessMode = restricted` 正确限制目标。
- public model 可路由到多个候选。
- model group 先选 member public model，再进入 candidate。
- auth/permission/model_not_found/bad_request 也会 failover。
- trace 能解释候选展开、过滤、sticky、每次 attempt 和最终结果。
- usage record 写入成功。
- 不支持能力的候选被过滤。
- fake upstream 覆盖成功、失败、failover、无候选。

## 非目标

- 不实现 SSE 流式。
- 不实现 first-token timeout。
- 不实现完整 UI usage 页面。

