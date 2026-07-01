# ManageYourLLM

个人自用的大模型网关与管理台。

当前目标是 v1.0.0 主链路闭环：从空库启动，完成 Setup Wizard，创建 Provider、Model、Client，成功通过 `/v1` 网关请求一次，并能在 Usage / Trace / Backups 中验证和恢复。

## 环境要求

- Node.js >= 22（推荐 24，见 `.nvmrc`）
- pnpm >= 9

## 开发

```bash
pnpm install
pnpm dev
```

默认端口：

- API：`http://127.0.0.1:5420`
- Web：`http://127.0.0.1:5421`

## 常用命令

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm e2e
```

## Docker

```bash
docker build -t manageyourllm:latest .
```

```bash
docker run -d \
  --name manageyourllm \
  -p 5420:5420 \
  -e NODE_ENV=production \
  -e MYLLM_SECRET_KEY='replace-with-strong-secret' \
  -e MYLLM_PUBLIC_BASE_URL='https://llm.example.com' \
  -v manageyourllm-data:/app/data \
  -v manageyourllm-logs:/app/logs \
  -v manageyourllm-backups:/app/backups \
  manageyourllm:latest
```

首个管理员通过 Setup Wizard 创建。生产环境必须设置 `MYLLM_SECRET_KEY`。

## 项目结构

```text
apps/
  api/          Fastify 5 + TypeScript
  web/          Vue 3 + Vite + Naive UI
packages/
  shared/       协议类型、错误、IR、provider descriptor
  contracts/    Zod request/response schema、API envelope
docs/           当前架构、产品决策、v1 闭环规格和运维指南
e2e/            Playwright 端到端测试
```

## 核心概念

- **Provider Account**：用户配置的上游账号和密钥。
- **Endpoint**：Provider Account 下的协议入口，也是健康、能力和路由边界。
- **Model**：客户端可请求的具体模型名。
- **Channel**：客户端可请求的用途频道，例如 `coder`、`fast`。
- **Client**：一个客户端接入配置，首版一个 Client 一个 active key。
- **Candidate**：一次 failover 可尝试的目标，指向 Provider Account + Endpoint + realModelName。

## 文档

- [架构设计](docs/architecture-rebuild.md)
- [产品决策](docs/product-decisions.md)
- [v1.0.0 闭环规格](docs/v1-closure.md)
- [v1.0.0 施工 TODO](docs/v1-construction-todo.md)
- [部署指南](docs/deployment.md)
- [备份与恢复](docs/backup-restore.md)
- [客户端配置](docs/client-setup.md)
- [排障指南](docs/troubleshooting.md)
