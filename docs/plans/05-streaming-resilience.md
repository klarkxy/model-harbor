# 05 Streaming & Resilience

Phase 4 实现流式请求和完整韧性能力。目标是首 token 之前可以 failover，首 token 之后保持同一条流，并补齐 sticky、熔断、健康、维护任务。

## 目标

- SSE streaming。
- First-token timeout failover。
- Conversation sticky。
- Session sticky。
- Circuit breaker。
- Cooldown。
- Endpoint health。
- Manual model ping。
- Maintenance jobs。

## 流式规则

- 首 token 前可以切换候选。
- 首 token 到达后响应已提交，不再切换候选。
- 流式结束后 best-effort 解析 usage。
- 跨协议流式仅在 adapter 明确支持时启用。
- 流式错误必须写 trace。

## Sticky

- conversation fingerprint 基于 system、前几条消息、metadata user id。
- session sticky 基于 consumer key + requested target。
- sticky 命中只能提升候选优先级。
- 候选不可用时 sticky 自动失效。

## Circuit breaker

- 维度：upstream key + real model。
- 状态：closed / open / half_open。
- 配置简单固定，未来可 UI 调整。
- 激进 failover 下 breaker 用于跳过近期明显坏的候选。

## Endpoint health

- 后台轻量探测 endpoint。
- 不自动对每个模型发 token 请求。
- 提供手动 model ping。
- 真实请求结果反哺健康状态。

## Maintenance jobs

- 清理 30 天前 trace。
- 清理临时 debug content logs。
- 重置过期 quota window。
- 清理过期 sticky。
- 清理过期 cooldown。
- 维护 circuit breaker 状态。
- 刷新 endpoint health。

## 任务清单

1. 实现 stream adapter contract。
2. 实现 Anthropic SSE。
3. 实现 OpenAI Chat SSE。
4. 实现 Responses SSE。
5. 实现 first-token timeout。
6. 实现 stream usage parser。
7. 实现 conversation sticky。
8. 实现 session sticky。
9. 实现 circuit breaker。
10. 实现 cooldown。
11. 实现 endpoint health worker。
12. 实现 manual model ping。
13. 实现 maintenance service。

## 验收标准

- 流式请求可以成功返回 SSE。
- 首 token 超时会尝试下一个候选。
- 首 token 到达后不会中途切换。
- sticky 命中、失效、替换写入 trace。
- breaker open 后候选被过滤。
- endpoint health 会影响排序但不直接删除候选。
- maintenance pass 可手动触发并有测试。

## 非目标

- 不做复杂智能路由。
- 不做模型级自动付费 ping。
- 不做长期内容日志。

