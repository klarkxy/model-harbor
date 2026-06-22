# ModelHarbor

ModelHarbor is a lightweight, dashboard-first LLM API router. It helps administrators manage multiple upstream API keys, model exposure, routing groups, quotas, and application-level usage through a clean visual interface.

> **Not a resale platform.** ModelHarbor intentionally avoids pricing, billing, payment, or affiliate features. Its sole purpose is to give you a transparent control plane for your LLM infrastructure.

---

## What It Does

- **Manage upstream keys** — Add, rotate, and monitor provider API keys (OpenAI, Anthropic, and compatible services).
- **Expose models cleanly** — Define public-facing model names and group them into administrator-defined collections.
- **Route with intelligence** — Sticky routing improves provider-side cache hits; automatic failover handles rate limits, quotas, and timeouts.
- **Track usage** — See per-app, per-key, per-model consumption without storing prompts or completions.
- **Control access** — Grant consumer keys fine-grained access to specific models or groups.
- **Admin dashboard first** — Every configuration is done through the UI; no YAML editing required.

---

## Supported Protocols

| Client Protocol         | Endpoint                    | Status                             |
| ----------------------- | --------------------------- | ---------------------------------- |
| Anthropic Messages      | `POST /v1/messages`         | ✅ Supported (stream + non-stream) |
| OpenAI Chat Completions | `POST /v1/chat/completions` | ✅ Supported (stream + non-stream) |
| OpenAI Responses        | `POST /v1/responses`        | ✅ Supported (stream + non-stream) |
| OpenAI Models List      | `GET /v1/models`            | ✅ Supported                       |

---

## Tech Stack

| Layer    | Technology                              |
| -------- | --------------------------------------- |
| Backend  | Node.js, Fastify 5, TypeScript          |
| Frontend | Vue 3, Vite, Naive UI, Pinia            |
| Database | SQLite (libsql) first, PostgreSQL later |
| ORM      | Drizzle                                 |
| Monorepo | pnpm workspaces                         |
| Test     | Vitest (unit), Playwright (e2e)         |
| License  | AGPL-3.0-or-later                       |

---

## Quick Start

### Requirements

- Node.js >= 22.10.0
- pnpm >= 9

### Install & Run

```bash
# Install dependencies
pnpm install

# Start API + dashboard in parallel (development)
# Dashboard: http://localhost:5421
# API:       http://localhost:5420
pnpm dev
```

> **Development mode:** Vite dev server serves the dashboard on port 5421 and proxies API calls to the Fastify backend on port 5420.
>
> **Production mode:** Build both packages (`pnpm build`), then `pnpm start` serves the dashboard and API from a single port (5420).

### First Login

The first admin account is created automatically from environment variables on first run:

| Variable                     | Default                  |
| ---------------------------- | ------------------------ |
| `MODELHARBOR_ADMIN_USERNAME` | `admin`                  |
| `MODELHARBOR_ADMIN_PASSWORD` | `change-me-on-first-run` |

> ⚠️ **Production:** Change the default password before exposing the service.

### Configure Your First Route

1. **Add an upstream key** — Go to **Upstream Keys** → **Add Key**. Enter your provider API key (e.g., OpenAI or Anthropic). The raw key is shown only once.
2. **Create a public model** — Go to **Public Models** → **Add Model**. Define the name clients will use (e.g., `gpt-4`) and map it to your upstream key's real model name.
3. **Create an app and consumer key** — Go to **Apps** → **Add App**, then generate a **Consumer Key** inside the app details. Grant it access to your model.
4. **Test the call**:

```bash
# OpenAI-compatible
curl http://localhost:5420/v1/chat/completions \
  -H "Authorization: Bearer mh_your_consumer_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Anthropic-compatible
curl http://localhost:5420/v1/messages \
  -H "x-api-key: mh_your_consumer_key" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Project Structure

```text
apps/
  api/         Fastify gateway + admin API
  web/         Vue 3 admin dashboard
packages/
  shared/      Protocol-neutral types, error classes, IR converters
docs/          Administrator guide, security, operations, troubleshooting
e2e/           Playwright end-to-end tests
```

---

## Environment Variables

| Variable                     | Default                     | Description                         |
| ---------------------------- | --------------------------- | ----------------------------------- |
| `MODELHARBOR_HOST`           | `0.0.0.0`                   | Bind address                        |
| `MODELHARBOR_PORT`           | `5420`                      | API port                            |
| `MODELHARBOR_DATABASE_URL`   | `file:./data/modelharbor.sqlite` | SQLite database path          |
| `MODELHARBOR_SECRET_KEY`     | `dev-secret-change-me`      | Encryption key for upstream secrets |
| `MODELHARBOR_ADMIN_USERNAME` | `admin`                     | First admin username                |
| `MODELHARBOR_ADMIN_PASSWORD` | `change-me-on-first-run`    | First admin password                |
| `MODELHARBOR_ADMIN_DISPLAY_NAME` | `Admin`                 | First admin display name            |
| `MODELHARBOR_LOG_LEVEL`      | `info`                      | Log level                           |
| `MODELHARBOR_LOG_FILE`       | `./logs/app.log`            | File log path                       |
| `MODELHARBOR_TRUST_PROXY`    | unset                       | Fastify `trustProxy` (e.g. `loopback`, `true`, CIDR list) |
| `MODELHARBOR_SERVE_WEB`      | unset                       | Set `1` to serve the built dashboard outside production mode |
| `NODE_ENV`                   | `development`               | Set `production` to enable production checks and serve the built dashboard |

> **Production note:** The default secret exists only for local development. Change `MODELHARBOR_SECRET_KEY`, `MODELHARBOR_ADMIN_PASSWORD` **and** `MODELHARBOR_ADMIN_USERNAME` before exposing the service; production mode rejects the default values. If `SECRET_KEY` is lost, encrypted upstream keys cannot be recovered.

---

## API Usage

### Authentication

All gateway requests require a Consumer Key.

**Preferred:** `Authorization: Bearer mh_your_consumer_key`

**Anthropic-compatible:** `x-api-key: mh_your_consumer_key`

If both are present, `Authorization` wins.

### Endpoints

#### POST /v1/chat/completions (OpenAI-compatible)

```bash
curl http://localhost:5420/v1/chat/completions \
  -H "Authorization: Bearer mh_your_consumer_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

#### POST /v1/messages (Anthropic-compatible)

```bash
curl http://localhost:5420/v1/messages \
  -H "x-api-key: mh_your_consumer_key" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

#### GET /v1/models

Lists all models and model groups the consumer key can access.

```bash
curl http://localhost:5420/v1/models \
  -H "Authorization: Bearer mh_your_consumer_key"
```

### Routing Behavior

**Sticky routing** — Same conversation (system + first messages + optional `user_id`) prefers the previously used `(upstream key, real model)` pair to improve provider-side cache hit rates. Bindings expire after 1 hour.

**Failover** — When an upstream returns rate-limit / quota / overload / timeout errors, ModelHarbor briefly cools down that candidate and retries the next one. Auth and permission errors stop immediately.

### Common Error Codes

| Status | Scenario                                               |
| ------ | ------------------------------------------------------ |
| 401    | Invalid or revoked consumer key                        |
| 403    | Consumer key has no access to this model               |
| 404    | Model name not found                                   |
| 429    | All candidates unavailable (cooldown / frozen / quota) |

---

## Key Features

### Provider Adapters

Protocol differences are isolated behind adapters. The router core never sees wire-format payloads.

- **Anthropic-compatible** — `POST /v1/messages`, `x-api-key`, `anthropic-version` header.
- **OpenAI-compatible** — `POST /v1/chat/completions`, `Authorization: Bearer`.

Both adapters normalize errors into a shared taxonomy (`rate_limit`, `quota`, `auth`, `timeout`, …) so the router can make consistent failover decisions.

### Sticky Routing

Conversation fingerprints (system + first messages + optional `user_id`) bind to a specific `(upstream key, real model)` pair. This improves provider-side cache hit rates. Bindings auto-expire after 1 hour and are ignored when the candidate becomes unavailable.

### Quotas & Cooldowns

Per-key counters track usage by hour, day, week, month, or total. When a limit is reached, the key is frozen with reason `quota_exceeded`. Rate-limit and timeout errors trigger brief cooldowns (15s–5min) before retrying the next candidate.

### Security Defaults

- Upstream and consumer keys are stored as hashes; raw values are shown only once at creation.
- Prompts and completions are **never** stored by default.
- Admin sessions use HTTP-only signed cookies.
- Login attempts are rate-limited.

---

## Development

```bash
pnpm install      # Install dependencies
pnpm dev          # Start API + dashboard
pnpm typecheck    # Type-check all packages
pnpm test         # Run unit tests
pnpm build        # Build for production
pnpm e2e          # Run end-to-end tests
```

---

## Documentation

- [管理员手册](docs/README.md) — 部署、配置、运维和排障指南
- [快速开始](docs/getting-started.md) — 安装、启动和第一条请求
- [部署与运维](docs/deployment.md) — 环境变量、备份、升级、健康检查
- [上游密钥配置](docs/upstream-keys.md) — 添加供应商 key、发现模型、配额
- [模型管理](docs/models.md) — 公共模型、模型组、候选与路由策略
- [应用与 Consumer Key](docs/apps-and-keys.md) — 接入授权与密钥管理
- [路由与韧性](docs/routing-and-resilience.md) — 熔断、健康探测、粘性、负载均衡
- [用量与监控](docs/usage-and-monitoring.md) — 统计、链路追踪、日志
- [安全配置](docs/security.md) — 密钥、加密、审计、内容日志
- [API 使用指南](docs/api-usage.md) — 下游调用网关的协议与示例
- [常见问题与排查](docs/troubleshooting.md) — 错误码、故障排查

---

## License

[AGPL-3.0-or-later](LICENSE)
