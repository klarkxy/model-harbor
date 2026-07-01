# 排障指南

ManageYourLLM 的排障入口是 **Traces**。一次 Trace 应解释：请求名称解析、候选展开、过滤原因、每次尝试、failover、breaker/cooldown、最终结果。

## 常见问题

### Client key 无效

特征：请求在网关入口失败，没有候选尝试。

检查：

- Authorization header 是否为 `Bearer <client-key>`。
- Client 是否启用。
- key 是否已轮换或失效。

### Model / Channel 不存在

特征：目标解析失败或候选为空。

检查：

- 请求的 `model` 是否是已启用的 Model 或 Channel 名称。
- Channel 中是否至少有一个启用的 Model。
- Model 中是否至少有一个启用 candidate。

### 所有候选都失败

特征：Trace 中多个 candidate attempt 均失败。

检查：

- 每个 candidate 的失败原因。
- Provider Account 是否 frozen。
- Endpoint 是否 disabled 或 unhealthy。
- Candidate 是否处于 breaker open / cooldown。
- real model 名称是否仍存在于上游。

### 速率限制、配额、超时

特征：上游返回 429、quota、timeout、5xx 或网络错误，网关继续尝试下一个 candidate。

检查：

- Providers 页面中对应 Endpoint 的健康状态。
- Candidate breaker/cooldown 状态。
- Costs / Plans 是否提示额度风险。
- Settings 中 timeout 是否过短。

### 配置错误

`bad_request`、`auth`、`permission`、`model_not_found` 通常表示配置或请求问题。它们应写入 Trace 并提示风险，但不应轻易冷却整个 Provider Account。

检查：

- Provider secret 是否正确。
- Endpoint base URL 和协议是否正确。
- Candidate 的 realModelName 是否正确。
- 请求是否使用了目标 endpoint 不支持的高级能力。

### Debug content

请求/响应内容默认不记录。需要短时间排查时，在 Traces 里开启临时内容记录，并设置过期时间和最大条数。内容写入前必须脱敏和截断。

## 提交排障信息

请收集：

- Trace ID。
- 请求的 Model 或 Channel 名称。
- Client 名称或 key 前后缀。
- Provider Account / Endpoint 名称。
- 最近日志片段。
