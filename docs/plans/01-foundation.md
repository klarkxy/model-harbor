# 01 Foundation

Phase 0 建立可持续开发的地基。这个阶段不实现完整业务，但要让项目可以安装、启动、测试、类型检查，并让后续阶段有清晰目录和契约承载点。

## 目标

- 创建 pnpm monorepo。
- 建立 API、Web、shared contracts 的包结构。
- 建立 TypeScript、ESLint、Prettier、Vitest、Playwright 基础配置。
- 建立 Zod contract 包。
- 建立空 Fastify server 和空 Vue shell。
- 建立 Docker 和环境变量骨架。

## 目录目标

```text
apps/
  api/
  web/
packages/
  contracts/
  shared/
docs/
  architecture-rebuild.md
  product-decisions.md
  plans/
```

## 任务清单

1. 初始化 workspace 文件。
   - `package.json`
   - `pnpm-workspace.yaml`
   - `.gitignore`
   - `.editorconfig`
   - `.prettierrc`
   - `tsconfig.base.json`

2. 创建 `packages/shared`。
   - IDs
   - normalized errors
   - protocols
   - IR types
   - provider capabilities

3. 创建 `packages/contracts`。
   - Zod request/response schema。
   - 管理 API 基础 envelope。
   - gateway protocol schema 占位。
   - 从 schema 导出 TypeScript 类型。

4. 创建 `apps/api`。
   - Fastify server builder。
   - `/healthz`
   - `/readyz`
   - 全局错误处理。
   - env parser。
   - test helper。

5. 创建 `apps/web`。
   - Vue 3 + Vite + Naive UI。
   - 基础 layout。
   - API client 骨架。
   - i18n 结构，中文优先。

6. 创建测试基线。
   - shared unit test。
   - contracts schema test。
   - API inject test。
   - Web smoke test。

7. 创建部署骨架。
   - Dockerfile。
   - `.env.example`。
   - 数据目录约定：`data/`、`logs/`、`backups/`。

## 验收标准

- `pnpm install` 成功。
- `pnpm typecheck` 成功。
- `pnpm test` 成功。
- `pnpm --filter @manageyourllm/api dev` 可启动并返回 health。
- `pnpm --filter @manageyourllm/web dev` 可打开空管理台。
- Docker build 至少能完成 API/Web build。

## 非目标

- 不实现数据库 schema。
- 不实现管理员登录。
- 不实现 provider 或 gateway。
- 不迁移旧代码。

