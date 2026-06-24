# 00 Roadmap

本路线图把 ManageYourLLM 从空分支推进到可自用的第一版。目标不是一次搬完旧项目，而是按阶段重建，每个阶段都明确产物和验收。

## 阶段概览

| 阶段 | 名称 | 主要产物 | 完成信号 |
| --- | --- | --- | --- |
| Phase 0 | Foundation | monorepo、工具链、contracts、基础文档 | 可以安装、测试、类型检查 |
| Phase 1 | Domain & Data | SQLite schema、repository、domain service | 核心领域单测通过 |
| Phase 2 | Admin Console | 管理 API、Setup Wizard、备份恢复、最小 UI | 可通过 UI 配置首个 provider |
| Phase 3 | Gateway Routing | 非流式 gateway、routing、adapter、usage/trace | fake upstream 完成三协议请求 |
| Phase 4 | Streaming & Resilience | SSE、first-token failover、sticky、breaker、health | 流式和韧性测试通过 |
| Phase 5 | Observability & Cost | Usage/Trace UI、成本套餐账本、模型榜单 | 可日常自用和排障 |

## 全局技术基线

- Node.js + TypeScript + Fastify。
- SQLite + Drizzle，SQLite 是长期主数据库。
- Vue 3 + Vite + Naive UI。
- pnpm workspace。
- Zod shared contracts。
- Vitest + Playwright。
- Docker 是推荐生产部署方式。

## 全局产品基线

- 个人自用，不做组织、多租户、RBAC、SSO。
- 不做支付、充值、分账或商业账单。
- Consumer Key 默认 `accessMode = all`，可切换为 `restricted`。
- Public Model 是多供应商池；Model Group 是业务语义组。
- failover 采用激进模式，所有上游错误都可尝试后续候选。
- sticky routing 是核心能力。
- 内容日志只做临时调试模式。
- 备份/恢复是首版重点。

## 阶段依赖

```text
Phase 0
  -> Phase 1
    -> Phase 2
      -> Phase 3
        -> Phase 4
          -> Phase 5
```

Phase 2 和 Phase 3 可以部分并行，但以 Phase 1 的 schema、repository、contracts 为前置。Phase 5 的成本账本可以在 Phase 2 后先做数据模型，但完整 UI 应在 gateway usage 稳定后完成。

## 首版总验收

- 可以通过 Setup Wizard 完成首个上游配置。
- 可以生成 Consumer Key，默认访问全部模型。
- 可以通过 Anthropic Messages、OpenAI Chat Completions、OpenAI Responses 发非流式请求。
- 可以通过流式请求，并在首 token 超时时 failover。
- 可以解释一次请求为什么选择某个候选。
- 可以查看 usage、trace、成本和套餐信息。
- 可以备份和恢复 SQLite 数据库。
- Docker 部署可用，生产模式拒绝默认 secret 和默认管理员密码。

## 风险清单

- 流式跨协议转换复杂，首版应只支持明确适配器声明的组合。
- 激进 failover 容易掩盖配置错误，trace 必须足够详细。
- 成本估算依赖模型定价数据，缺价时要显示“不计价”而不是误报。
- 备份恢复涉及 secret key，UI 必须清楚提示恢复条件。
- Setup Wizard 可能变成大泥球，需要让 wizard 调用 application services，不直接写 DB。

