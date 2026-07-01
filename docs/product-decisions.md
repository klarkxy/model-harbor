# ManageYourLLM 产品决策

本文档记录当前已锁定的 v1.0.0 产品决策。若代码、README 或 AGENTS 与本文冲突，以本文和 `docs/architecture-rebuild.md` 为准。

## 定位

- 产品名：ManageYourLLM。
- 中文定位：管理你的大模型。
- 类型：个人自用 LLM 网关与管理台。
- 目标用户：个人开发者 / 同时维护多个 LLM provider 和客户端工具的人。

核心优先级：

1. 稳定接入和顺序 failover。
2. 可解释 trace。
3. 管理 UI 顺手。
4. 成本和备份可控。

## 不做

- 组织、多租户、RBAC、OIDC、SSO。
- 充值、售卖、支付、分账、企业账单。
- PostgreSQL。
- 旧数据库自动迁移。
- Codex OAuth。
- 本机客户端配置自动写入。
- 成本/质量/速度参与自动路由。

## v1.0.0 必须保留

- Provider Account 与可编辑 Endpoint。
- Model 和 Channel 两类可请求名称。
- Client + active key。
- OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Models List。
- 顺序 failover。
- candidate 级 cooldown / circuit breaker / endpoint health。
- Usage、Trace、Costs。
- Backups。
- Setup Wizard 完整闭环。

## 命名决策

旧名与新名对应：

| 旧心智 | v1 命名 | 说明 |
| --- | --- | --- |
| Upstream Key | Provider Account / 上游账号 | 保存用户账号、密钥和默认配置。 |
| Public Model | Model / 模型 | 客户端可请求的具体模型名。 |
| Model Group | Channel / 频道 | 客户端可请求的用途入口。 |
| App | Client / 客户端 | 一个接入方，一个 active key。 |
| Consumer Key | Client key | 用户不需要把它当一等对象管理。 |
| Debug Content Logs | Trace 临时内容记录 | 默认隐藏，不做独立导航。 |

## Provider 与 Endpoint

- Provider Preset 只是模板，内置只读。
- Provider Account 是用户实例，可以自由修改。
- Endpoint 是协议、健康、能力、模型发现和路由边界。
- 用户可以新增、删除、禁用和覆盖 endpoint。
- UI 必须提供“恢复模板默认 endpoint”。

## Model 与 Channel

- Model 背后是一组有序 candidate。
- Channel 背后是一组有序 Model。
- 客户端统一通过 `model` 字段请求 Model 或 Channel 的名称。
- Channel 首版不做 weighted / round-robin / rule engine。
- Candidate 排序由用户拖拽决定。

## Client

- 首版一个 Client 一个 active key。
- 创建 Client 时直接生成 key，raw key 只展示一次。
- Rotate key 是 Client 动作。
- 暂不做模型权限、restricted access、client type。
- 配置片段以 OpenAI-compatible、Anthropic-compatible、cURL 为主。

## 路由

- 全部路由默认按顺序 failover。
- 不做智能调度。
- 成本不参与路由。
- Endpoint health 可以影响“是否跳过/提示风险”，但不能改变用户显式排序为黑箱排序。
- breaker/cooldown 只跳过明显不可用的 candidate。

## Costs

Costs 是个人账本，不是计费系统：

- 模型定价。
- 用量成本。
- token/coding plan。
- 购买时间、到期时间、剩余额度、提醒。

Costs 与 Usage / Trace 互相跳转，但不影响路由。

## Backups

- 完整数据库备份是首版必需能力。
- 恢复前必须先备份当前库。
- 完整备份恢复需要同一个 `MYLLM_SECRET_KEY`。
- 非敏感配置导出不包含原始 secret 或 raw Client key。

## Setup Wizard

Setup Wizard 不能跳过核心链路。完成条件：

1. 管理员已创建。
2. 至少一个 Provider Account 已创建。
3. 至少一个 Endpoint 测通。
4. 至少一个 Model 或 Channel 可请求。
5. 至少一个 Client + key 已创建。
6. 通过网关完成一次测试请求。

失败时必须留在 Wizard 中，并给出错误原因和返回修改入口。

## UI 导航

左侧导航按组展示：

```text
运行状态：Overview
配置核心：Providers / Models / Clients
观测排障：Usage / Traces
成本管理：Costs
运维：Backups / Settings
```

Settings 不承载业务对象和危险操作；Backups、Costs、Clients、Models 都有独立页面。
