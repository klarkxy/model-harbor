# ManageYourLLM 架构设计

本文档是当前项目的架构与产品边界来源。旧的阶段式重构计划已经废弃；后续实现以 v1.0.0 主链路闭环为目标。

## 1. 产品目标

ManageYourLLM 是个人自用的大模型网关与管理台。它解决四件事：

1. 管理多个上游供应商账号和 endpoint。
2. 对客户端暴露稳定的 Model / Channel 名称。
3. 按用户配置顺序进行可解释 failover。
4. 记录 usage / trace / cost，并提供可恢复的备份能力。

明确不做：

- 组织平台、多租户、RBAC、SSO/OIDC。
- 充值、支付、分账、转售、企业账单。
- PostgreSQL 兼容和旧库自动迁移。
- Codex OAuth 或本机客户端配置文件自动写入。
- 成本感知、质量感知、智能调度等自动路由策略。

## 2. 核心对象

```text
Provider Preset
  内置模板，只读，描述默认 endpoint、协议、模型提示、文档和能力。

Provider Account
  用户配置的上游账号和密钥。Preset 只是创建时的默认值，用户之后可以自由修改。

Endpoint
  Provider Account 下的协议入口。协议、健康、延迟、能力、模型发现和韧性状态都落在 endpoint 上。

Model
  客户端可请求的具体模型名。背后是一组按顺序排列的 candidate。

Channel
  客户端可请求的用途频道，例如 coder / fast / cheap。首版只是有序 Model 集合，不做复杂策略。

Candidate
  一次路由可尝试的目标，指向 Provider Account + Endpoint + realModelName。

Client
  一个客户端接入配置。首版一个 Client 一个 active key，不做权限、不做客户端类型。
```

一句话边界：

```text
Provider Account 是认证/账号边界。
Endpoint 是协议/健康/能力/路由边界。
Model 是客户端可见模型边界。
Channel 是客户端可见用途边界。
Candidate 是 failover 边界。
Client 是接入凭证边界。
```

## 3. v1.0.0 主链路

v1.0.0 的定义不是功能最多，而是以下链路完整跑通：

```text
空库启动
  -> Setup Wizard 创建管理员
  -> 创建 Provider Account
  -> 至少一个 Endpoint 测通
  -> 发现或手动添加 Model
  -> 创建 Client 和 key
  -> 复制配置片段
  -> 通过网关成功请求一次
  -> Usage / Trace 能解释这次请求
  -> Backups 能备份当前状态
```

Setup Wizard 不允许跳过核心链路。最后一次网关测试失败时，不能显示完成；应停在测试失败页并给出 trace / 错误 / 返回修改入口。

## 4. 路由规则

首版只做顺序 failover：

```text
请求 model 名称
  -> 解析为 Model 或 Channel
  -> Channel 展开为有序 Model 列表
  -> Model 展开为有序 Candidate 列表
  -> 过滤不可用 candidate
  -> 原生协议优先，安全时才允许跨协议转换
  -> 按用户顺序尝试
  -> 失败后尝试下一个
```

不做：

- weighted routing
- round robin
- cost-aware routing
- quality-aware routing
- model leaderboard 自动参与路由
- 规则引擎或黑箱调度

过滤顺序建议：

1. Provider Account / Endpoint / Model / Candidate 是否启用。
2. Provider Account 是否 frozen。
3. Candidate 是否处于 cooldown 或 breaker open。
4. endpoint 能力是否满足请求。
5. 协议是否原生匹配；跨协议只允许基础请求。
6. 配额是否可用。

排序永远由用户配置决定；熔断和冷却只临时跳过明显不可用的 candidate。

## 5. Endpoint 与韧性

OpenCode Go / Zen、Moonshot、MiniMax 等供应商可能在一个账号下有多个 endpoint。不要把 provider 当成单 endpoint。

示例：

```text
OpenCode Go
  Endpoint: OpenAI Chat        /v1/chat/completions
  Endpoint: Anthropic Messages /v1/messages

OpenCode Zen
  Endpoint: OpenAI Responses   /v1/responses
  Endpoint: Anthropic Messages /v1/messages
  Endpoint: OpenAI Chat        /v1/chat/completions
```

韧性状态应按 candidate 维度设计：

```text
providerAccountId
endpointId
realModelName
breakerState
cooldownUntil
failureCount
successCount
lastError
```

`timeout`、`rate_limit`、`quota`、`overloaded`、`5xx`、网络错误等可累计熔断。`bad_request`、`auth`、`permission`、`model_not_found` 应记录 trace 并提示配置风险，但不要轻易自动冷却整个账号。

## 6. 管理 UI

左侧导航按功能分组：

```text
运行状态
  Overview

配置核心
  Providers
  Models
  Clients

观测排障
  Usage
  Traces

成本管理
  Costs

运维
  Backups
  Settings
```

页面边界：

- **Overview**：只展示需要行动的信息，如异常 endpoint、最近失败、今日请求/成本、套餐风险、Base URL、下一步。
- **Providers**：Provider Account、endpoint、模型发现、ping、health、quota、冻结、恢复模板默认值。
- **Models**：Tabs 为 Models / Channels / Reference。Candidate 是详情里的内部概念。
- **Clients**：一个 Client 一个 active key，提供 OpenAI / Anthropic / cURL 配置片段和 rotate key。
- **Usage**：请求、token、模型、provider、错误率和成本来源。
- **Traces**：解释每次请求的解析、过滤、尝试、failover、breaker/cooldown 事件。Debug content 是 Trace 的临时内容 tab，不做独立导航。
- **Costs**：模型定价、用量成本、套餐账本、到期提醒；不参与路由。
- **Backups**：完整备份、恢复、非敏感配置导出/导入、备份健康检查。
- **Settings**：只放系统级参数，如 publicBaseUrl、timeout、retry、sticky、breaker、health probe、临时内容日志开关。

## 7. Models 页面

Models 页面面向“客户端能请求哪些名称”。

```text
Models tab
  Model = 一个具体对外模型名，背后是一组 endpoint + realModel candidate。

Channels tab
  Channel = 一个用途入口，成员是有序 Models。首版不做规则策略。

Reference tab
  模型参考榜单 / 推荐助手，不参与实时路由。推荐结果必须由用户确认后写入。
```

Provider 模型发现后的主流程：

```text
发现模型
  -> 勾选 real model
  -> 选择暴露名称
  -> 创建/更新 Model candidate
  -> 可选加入 Channel
```

## 8. Clients

首版 Client 极简：

- name
- active key
- enabled
- 配置片段
- 最近 usage / trace

不做：

- client type
- 一个 Client 多个常规 key
- 模型权限
- restricted access UI

数据库可保留扩展余地，但用户心智中 Consumer Key 是 Client 的实现细节。

## 9. 数据与代码边界

后端依赖方向：

```text
server/routes -> application -> domain
application -> repository/provider ports
infrastructure -> port implementations
```

当前代码仍有 application 直接依赖 infrastructure row/repository 的情况。v1 重构优先把 routing/gateway 主链路迁移到运行时 snapshot：

```text
ProviderAccountSnapshot
EndpointSnapshot
CandidateSnapshot
RoutingSettingsSnapshot
```

路由核心不应长期持有 DB row。

## 10. 网关入口

v1 固定公开网关 base path 为 `/v1`。保留 `publicBaseUrl` 用于生成配置片段和部署提示；不再把 `gatewayBasePath` 作为用户可配置项。

支持入口：

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`

## 11. 测试与验收

v1 验收必须覆盖：

- 空库 Setup Wizard 完整链路。
- Provider Account + 多 endpoint 创建和编辑。
- Model / Channel 顺序 failover。
- candidate 级 breaker/cooldown 过滤。
- Client key 创建、轮换和配置片段。
- 一次真实 fake-upstream 网关请求成功。
- Usage / Trace 能解释该请求。
- Backups 能完整备份并恢复。

常规质量门禁：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm e2e
```
