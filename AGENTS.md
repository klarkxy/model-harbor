# ManageYourLLM 重构分支 — AGENTS.md

本文件面向 AI 编码助手。阅读前请知悉：当前仓库（`llm-router-rebuild-clean`）**已完成 Phase 1（Domain & Data）**，已落地 SQLite schema（v1）、repository / unit-of-work、核心 domain/application service 与对应测试。下文基于仓库中实际存在的文档与代码整理。

## 项目概述

- **产品名**：ManageYourLLM（中文定位：管理你的大模型）。
- **仓库定位**：`codex/rebuild-clean` 分支，是旧项目 `D:\0 code\llm-router` 的重建规划仓库，参考项目 `reference/cc-switch` 位于旧项目目录内。
- **当前状态**：Phase 1 已完成。在 Phase 0 骨架基础上，已落地 SQLite schema（v1）、显式 migration runner、repository / unit-of-work、核心 domain/application service（auth、upstream secret、consumer key、access policy、public model、model group、cost-ledger、backup）以及对应的测试。API 启动时会自动初始化 schema 和默认设置。
- **目标**：按阶段从零重建 ManageYourLLM，保留已验证的产品能力，改用更清晰的分层与模块边界，而非一次性搬迁旧代码。

## 产品定位与边界

- **类型**：个人自用的大模型网关与 Provider 管理台。
- **目标用户**：个人开发者 / 自己维护多个 LLM provider 和客户端工具的人。
- **明确不做**：组织平台、多租户、RBAC、SSO/OIDC、充值、支付、分账、售卖模型、企业账单、PostgreSQL、旧数据库自动迁移、Codex OAuth、本机客户端配置文件自动写入、Tauri/桌面托盘伴侣程序（后续增强）。
- **首版必须保留**：Anthropic Messages、OpenAI Chat Completions、OpenAI Responses、Models List、上游 key 管理、provider preset、public model、model group、failover、cooldown、circuit breaker、endpoint health、sticky routing、trace、usage、成本统计和套餐账本、模型参考榜单、管理 UI、备份/恢复、Setup Wizard。

## 已落地的技术栈

- **后端**：Node.js + TypeScript + Fastify 5。
- **数据库**：SQLite 长期主数据库 + Drizzle/libsql；Schema v1、migration runner、repository、unit-of-work 已实现。
- **前端**：Vue 3 + Vite + Naive UI + Pinia。
- **Monorepo**：pnpm workspace。
- **契约与校验**：Zod 共享 schema。
- **测试**：Vitest + Playwright。Phase 1 已新增 repository、domain、application 层单元测试。
- **部署**：Node 直跑和 Docker 都支持；公网/生产推荐 Docker。单进程一体化部署，同端口服务管理 UI、管理 API、网关 API、健康检查，并运行后台维护任务。

### 目录结构

```text
apps/
  api/       Fastify + TypeScript + Drizzle（依赖已声明）
  web/       Vue 3 + Vite + Naive UI
packages/
  shared/    协议类型、错误、IR、provider descriptor
  contracts/ Zod request/response schema、管理 API envelope
docs/        架构、产品决策、阶段计划与 TODO
e2e/         Playwright 端到端测试（占位）
```

后端内部进一步按 `server/routes -> application -> domain -> infrastructure` 分层，核心依赖方向禁止 `domain` 导入 Fastify/Drizzle/Vue 等实现细节。Phase 1 已创建 `infrastructure/db`、`domain/`、`application/` 目录并落地核心实现。

## 文档清单

| 文件                                    | 内容                                                                                                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture-rebuild.md`          | 完整重构架构设计：目标、现状痛点、分层、领域边界、provider descriptor、数据访问、前端架构、网关流程、错误模型、测试策略、迁移阶段、MVP 验收、未决问题。                                                         |
| `docs/product-decisions.md`             | 产品决策记录：定位、商业边界、首版保留/后移/不做、技术栈、部署与安全、数据与迁移、路由哲学、Public Model 与 Model Group、模型参考榜单、Provider Preset、管理 UI、客户端支持、可观测与日志、健康探测、后续增强。 |
| `docs/plans/README.md`                  | 阶段计划总览与执行原则。                                                                                                                                                                                        |
| `docs/plans/00-roadmap.md`              | 完整路线图、阶段顺序、依赖、全局技术/产品基线、首版总验收、风险清单。                                                                                                                                           |
| `docs/plans/01-foundation.md`           | Phase 0：项目骨架、目录目标、任务清单、验收标准。                                                                                                                                                               |
| `docs/plans/02-domain-data.md`          | Phase 1：SQLite schema、repository、domain service、验收标准。                                                                                                                                                  |
| `docs/plans/03-admin-console.md`        | Phase 2：管理 API、Setup Wizard、备份恢复、最小 UI。                                                                                                                                                            |
| `docs/plans/04-gateway-routing.md`      | Phase 3：非流式网关、路由决策、provider adapter、可观测副作用。                                                                                                                                                 |
| `docs/plans/05-streaming-resilience.md` | Phase 4：SSE、first-token failover、sticky、熔断、健康、维护任务。                                                                                                                                              |
| `docs/plans/06-observability-cost.md`   | Phase 5：Usage/Trace、成本套餐账本、模型参考榜单、运维完善。                                                                                                                                                    |
| `docs/plans/todos/*.todo.md`            | 每个阶段的编号 TODO 清单，格式为 `- [ ] P0-001 Task title`，并包含依赖、交付物、验收标准。                                                                                                                      |

## 当前构建与测试状态

- 已创建 `package.json`、`pnpm-workspace.yaml`、`.gitignore`、`.prettierrc`、ESLint/Vitest/Playwright 配置。
- 已创建源码目录 `apps/`、`packages/`。
- 已创建 `Dockerfile`、`.env.example`，数据目录约定为 `data/`、`logs/`、`backups/`。
- 可用命令：
  - `pnpm install` — 安装依赖
  - `pnpm dev` / `pnpm dev:api` / `pnpm dev:web` — 开发启动
  - `pnpm build` — 构建所有 workspace 包
  - `pnpm typecheck` — 全仓库类型检查
  - `pnpm test` — 运行单元测试
  - `pnpm lint` / `pnpm format` / `pnpm format:check` — 代码质量
  - `pnpm e2e` / `pnpm e2e:install` — Playwright（占位）
- Phase 1 验收基线：`pnpm install` / `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm format:check` / `pnpm build` 成功；API 启动后可自动建表并查询到 schema version 1。

## 代码组织（计划）

### 后端分层

```text
apps/api/src/
  main.ts
  server/          # Fastify 路由、插件、全局错误处理
  config/          # 环境变量解析
  domain/          # 纯领域逻辑，不依赖框架（Phase 1 已实现 auth、upstream secret、consumer key、access policy、model-catalog、cost-ledger、backup）
  application/     # 应用服务，编排 domain + repository（Phase 1 已实现 admin-auth、upstream-key）
  infrastructure/  # 数据库、repository、unit-of-work 已实现；provider adapter、上游发送、日志等后续阶段补充
  contracts/       # 管理 API / 网关 API 契约（优先使用 packages/contracts）
```

关键领域：`auth/access`、`upstream`、`model-catalog`、`cost-ledger`、`backups`、`routing`、`gateway`、`observability`、`settings`。

### 前端组织

```text
apps/web/src/
  api/             # client.ts、contracts.ts
  resources/       # useUpstreamKeys、usePublicModels 等 resource composables（后续创建）
  pages/           # 页面
  components/      # 组件
  stores/          # Pinia stores
  theme/
  i18n/            # 中文优先，保留 i18n 结构
```

### 关键模块职责

- **Identity & Access**：管理员登录/session/密码、Consumer Key 生成与哈希、App 授权、`accessMode = all | restricted`。
- **Upstream**：上游 key CRUD、provider preset、模型发现、ping、健康探测。
- **Model Exposure**：`target_names`、public model、candidate、model group。
- **Routing**：目标解析、候选展开、过滤（enabled/frozen/cooldown/quota/breaker/capability/protocol）、排序、sticky、failover。
- **Gateway Execution**：IR -> provider adapter -> 上游请求 -> 响应归一化 -> 下游协议映射。
- **Observability**：trace、usage、audit、临时 debug content log、脱敏。
- **Cost & Plan Ledger**：定价、成本估算、日/月统计、token/coding plan、续费提醒。
- **Backup & Restore**：完整 SQLite 快照、升级前自动备份、非敏感配置导出。

## 测试策略（计划）

- **shared**：IR、capabilities、descriptor 校验。
- **domain**：routing policy、candidate filtering、sticky fingerprint、quota window、breaker state。
- **application**：public model 创建事务、upstream onboarding、consumer key access、gateway orchestration。
- **infrastructure**：repository migration、SQLite constraint、provider auth decrypt。
- **adapter contract**：每个 provider adapter 的 request/response/error/usage 样例。
- **API integration**：Fastify inject 覆盖 admin routes 和 gateway routes。
- **stream tests**：首 token timeout、SSE usage、failover before commit。
- **web tests**：关键页面和 composable。
- **e2e**：登录、创建上游 key、创建模型、生成 consumer key、发起一次网关请求。

测试原则：路由决策尽量纯函数化；对上游请求使用 fake upstream，不连真实供应商；所有 secret/redaction 有专门回归测试。

## 开发约定

- **语言**：项目文档、UI、注释以**中文**为主，保留 i18n 结构；首版不强制完整多语言。
- **依赖方向**：`server/routes -> application -> domain`；`application -> repository 接口 + provider 接口`；`infrastructure -> domain/application ports`。
- **禁止**：`domain` 导入 Fastify、Drizzle、libsql、pino、Vue；`domain/routing` 不导入 provider wire request/response；`server/routes` 不直接写数据库；`providers/adapters` 不直接写 usage/trace/quota。
- **数据写入**：统一经过 repository / unit-of-work，关键变更有事务边界。
- **Secret 处理**：上游 secret 加密落库；Consumer Key 只存 hash + prefix + suffix，原文仅在创建/轮换时返回一次。
- **内容日志**：默认关闭，仅作为临时调试模式，短窗口或最近 N 条，自动关闭，写入前脱敏和截断。
- **备份**：完整数据库备份需要同一个 `SECRET_KEY` 才能解密上游 key；非敏感配置导出不含原始 secret。

## 安全与部署考虑

- 管理后台使用本地管理员账号 + HTTP-only session cookie；登录失败限流。
- 生产模式拒绝默认管理员密码和默认 secret。
- 支持 reverse proxy / public base URL / trust proxy。
- 单进程 + SQLite + Docker 友好，不引入 Redis、队列或多服务。
- 数据目录约定：`data/`、`logs/`、`backups/`。
- Docker 镜像默认以 `NODE_ENV=production` 运行，需要显式设置 `MYLLM_SECRET_KEY`、`MYLLM_ADMIN_PASSWORD`、`MYLLM_ADMIN_USERNAME`。

## 未决问题

文档中明确记录、需在正式编码前确认：

- public endpoint base path 是否继续启动时读取，还是支持热更新路由。
- 内置模型参考榜单的固定来源选择。
- 本地自定义 provider preset 存 SQLite 还是单独 JSON。
- Docker 镜像的默认 volume 布局（已约定 `data/`、`logs/`、`backups/`）。
- 自动备份保留数量和手动备份保留策略的精确默认值。
- 临时内容调试模式的默认窗口：例如 30 分钟 / 100 条。

## 给后续 Agent 的行动建议

1. 做任何改动前请先通读 `docs/architecture-rebuild.md` 和 `docs/product-decisions.md`，它们优先于旧项目的默认假设。
2. Phase 1（Domain & Data）已完成。下一步进入 Phase 2（Admin Console）：按 `docs/plans/todos/phase-2-admin-console.todo.md` 推进，不要跳到后续阶段。
3. 不要假设旧项目代码可以直接复制；新分支要求重新分层。
4. 计划更新时必须写入 `docs/` 中的对应文件，不要只留在聊天记录里。
5. 保持中文文档和中文 UI 优先，同时保留 i18n 扩展结构。
6. 修改 `AGENTS.md` 中描述的任何文件/结构/配置后，必须同步更新本文件。
