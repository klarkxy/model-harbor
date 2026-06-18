# ModelHarbor 模型港

ModelHarbor（模型港）是一个轻量级、以仪表盘为核心的 LLM API 路由网关。它帮助管理员通过清晰的可视化界面管理多个上游 API 密钥、模型暴露、路由分组、配额以及应用级别的用量统计。

> **不是转售平台。** ModelHarbor 有意避开了定价、计费、支付、充值、分销等商业化功能。它的唯一目的是为你的 LLM 基础设施提供一个透明的控制平面。

---

## 功能概述

- **管理上游密钥** — 添加、轮换和监控提供商 API 密钥（OpenAI、Anthropic 及兼容服务）。
- **清晰暴露模型** — 定义面向公众的模型名称，并将其分组为管理员自定义的集合。
- **智能路由** — 粘性路由提升提供商侧缓存命中率；自动故障转移处理速率限制、配额耗尽和超时。
- **用量追踪** — 查看按应用、按密钥、按模型的消耗情况，且不存储提示词和生成内容。
- **访问控制** — 为消费密钥授予对特定模型或模型组的细粒度访问权限。
- **仪表盘优先** — 所有配置都通过 UI 完成；无需编辑 YAML。

---

## 支持的协议

| 客户端协议              | 端点                        | 状态                     |
| ----------------------- | --------------------------- | ------------------------ |
| Anthropic Messages      | `POST /v1/messages`         | ✅ 支持（流式 + 非流式） |
| OpenAI Chat Completions | `POST /v1/chat/completions` | ✅ 支持（流式 + 非流式） |
| OpenAI 模型列表         | `GET /v1/models`            | ✅ 支持                  |

---

## 技术栈

| 层级     | 技术                                         |
| -------- | -------------------------------------------- |
| 后端     | Node.js, Fastify 5, TypeScript               |
| 前端     | Vue 3, Vite, Naive UI, Pinia                 |
| 数据库   | SQLite (libsql) 优先，后续支持 PostgreSQL    |
| ORM      | Drizzle                                      |
| monorepo | pnpm workspaces                              |
| 测试     | Vitest（单元测试）, Playwright（端到端测试） |
| 许可证   | AGPL-3.0-or-later                            |

---

## 快速开始

### 环境要求

- Node.js >= 20.10.0
- pnpm >= 9

### 安装并运行

```bash
# 安装依赖
pnpm install

# 开发模式：并行启动 API + 仪表盘
# 仪表盘: http://localhost:5173
# API:     http://localhost:3000
pnpm dev
```

> **开发模式：** Vite 开发服务器在 5173 端口提供仪表盘，并将 API 请求代理到 Fastify 后端（3000）。
>
> **生产模式：** 先构建（`pnpm build`），然后 `pnpm start` 会从单一端口（3000）同时提供仪表盘和 API。

### 首次登录

首次运行时会根据环境变量自动创建管理员账号：

| 变量                         | 默认值                   |
| ---------------------------- | ------------------------ |
| `MODELHARBOR_ADMIN_USERNAME` | `admin`                  |
| `MODELHARBOR_ADMIN_PASSWORD` | `change-me-on-first-run` |

> ⚠️ **生产环境：** 务必修改默认密码后再暴露服务。

### 配置你的第一个路由

1. **添加上游密钥** — 进入 **上游密钥** → **添加密钥**，输入你的提供商 API 密钥（如 OpenAI 或 Anthropic）。原始密钥仅在创建时显示一次。
2. **创建公开模型** — 进入 **公开模型** → **添加模型**，定义客户端将使用的名称（如 `gpt-4`），并映射到上游密钥的真实模型名。
3. **创建应用和消费密钥** — 进入 **应用** → **添加应用**，然后在应用详情页生成 **消费密钥**。授予它访问你的模型的权限。
4. **测试调用**：

```bash
# OpenAI 兼容格式
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer mh_你的消费密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "你好！"}]
  }'

# Anthropic 兼容格式
curl http://localhost:3000/v1/messages \
  -H "x-api-key: mh_你的消费密钥" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好！"}]
  }'
```

---

## 项目结构

```text
apps/
  api/         Fastify 网关 + 管理 API
  web/         Vue 3 管理仪表盘
packages/
  shared/      协议无关的类型、错误类、IR 转换器
docs/          架构设计、API 契约、安全模型、运维文档
e2e/           Playwright 端到端测试
```

---

## 环境变量

| 变量                         | 默认值                      | 说明              |
| ---------------------------- | --------------------------- | ----------------- |
| `MODELHARBOR_HOST`           | `0.0.0.0`                   | 绑定地址          |
| `MODELHARBOR_PORT`           | `3000`                      | API 端口          |
| `MODELHARBOR_DATABASE_URL`   | `file:./modelharbor.sqlite` | SQLite 数据库路径 |
| `MODELHARBOR_SECRET_KEY`     | _(无)_                      | 上游密钥加密密钥  |
| `MODELHARBOR_ADMIN_USERNAME` | `admin`                     | 首个管理员用户名  |
| `MODELHARBOR_ADMIN_PASSWORD` | `change-me-on-first-run`    | 首个管理员密码    |
| `MODELHARBOR_LOG_LEVEL`      | `info`                      | 日志级别          |

> **生产环境注意：** 在暴露服务前，务必修改 `MODELHARBOR_SECRET_KEY` 和 `MODELHARBOR_ADMIN_PASSWORD`。如果 `SECRET_KEY` 丢失，加密的上游密钥将无法恢复。

---

## API 使用指南

### 认证

所有网关请求需要携带消费密钥。

**推荐方式：** `Authorization: Bearer mh_你的消费密钥`

**Anthropic 兼容：** `x-api-key: mh_你的消费密钥`

> 如果两者同时存在，`Authorization` 优先。

### 端点

#### POST /v1/chat/completions（OpenAI 兼容）

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer mh_你的消费密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "你好！"}],
    "stream": true
  }'
```

#### POST /v1/messages（Anthropic 兼容）

```bash
curl http://localhost:3000/v1/messages \
  -H "x-api-key: mh_你的消费密钥" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好！"}],
    "stream": true
  }'
```

#### GET /v1/models

列出当前消费密钥有权限访问的所有模型和模型组。

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer mh_你的消费密钥"
```

### 路由行为

**粘性路由** — 相同对话（基于系统提示 + 前几条消息 + 可选 `user_id`）会优先路由到之前使用过的 `(上游密钥, 真实模型)` 组合，以提高提供商侧的缓存命中率。绑定在 1 小时后自动过期。

**故障转移** — 当上游返回速率限制 / 配额耗尽 / 过载 / 超时错误时，ModelHarbor 会短暂冷却该上游并尝试下一个候选。认证和权限错误会立即停止，不会重试。

### 常见错误码

| 状态码 | 场景                                     |
| ------ | ---------------------------------------- |
| 401    | 消费密钥无效或已撤销                     |
| 403    | 消费密钥没有该模型的访问权限             |
| 404    | 请求的模型名称不存在                     |
| 429    | 所有候选上游都不可用（冷却/冻结/超配额） |

---

## 核心特性

### 提供商适配器

协议差异被隔离在适配器之后。路由核心永远不会看到原始格式的请求/响应负载。

- **Anthropic 兼容** — `POST /v1/messages`，`x-api-key`，`anthropic-version` 请求头。
- **OpenAI 兼容** — `POST /v1/chat/completions`，`Authorization: Bearer`。

两种适配器都将错误归一化为共享的分类体系（`rate_limit`、`quota`、`auth`、`timeout` …），以便路由器做出一致的故障转移决策。

### 粘性路由

对话指纹（系统提示 + 前几条消息 + 可选 `user_id`）绑定到特定的 `(上游密钥, 真实模型)` 对。绑定在 1 小时后自动过期，且当候选不可用时会被忽略。

### 配额与冷却

按密钥计数器追踪按小时、天、周、月或总计的用量。当达到限制时，密钥会被冻结，原因为 `quota_exceeded`。速率限制和超时错误会触发短暂的冷却期（15 秒–5 分钟），然后重试下一个候选。

### 安全默认

- 上游密钥和消费密钥均以哈希存储；原始值仅在创建时展示一次。
- 提示词和生成内容**默认永不存储**。
- 管理员会话使用 HTTP-only 签名 Cookie。
- 登录尝试有速率限制。

---

## 开发

```bash
pnpm install      # 安装依赖
pnpm dev          # 启动 API + 仪表盘
pnpm typecheck    # 类型检查
pnpm test         # 运行单元测试
pnpm build        # 生产构建
pnpm e2e          # 运行端到端测试
```

---

## 文档

- [Architecture](docs/architecture.md) — 系统设计与包边界
- [API Contract](docs/api-contract.md) — 网关与管理端点（开发者参考）
- [Security Model](docs/security.md) — 认证、授权与隐私
- [Operations](docs/operations.md) — 部署、备份与健康检查
- [Provider Adapters](docs/provider-adapters.md) — 适配器接口与能力声明

---

## 许可证

[AGPL-3.0-or-later](LICENSE)
