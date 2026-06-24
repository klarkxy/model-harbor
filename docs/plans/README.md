# ManageYourLLM 重构计划总览

本目录把架构蓝图拆成可执行计划。计划文档以“能交付、能验收、能回退”为原则组织。

## 计划索引

- `00-roadmap.md`：完整路线图、阶段顺序、依赖和全局验收。
- `01-foundation.md`：Phase 0，项目骨架、工具链、契约和基础文档。
- `02-domain-data.md`：Phase 1，领域模型、SQLite schema、repository 和基础服务。
- `03-admin-console.md`：Phase 2，管理 API、Setup Wizard、备份恢复和管理 UI。
- `04-gateway-routing.md`：Phase 3，非流式网关、路由决策、provider adapter 和可观测副作用。
- `05-streaming-resilience.md`：Phase 4，流式网关、first-token failover、sticky、熔断、健康和维护任务。
- `06-observability-cost.md`：Phase 5，Usage/Trace、成本套餐账本、模型参考榜单和运维完善。

## 执行原则

- 每个阶段都必须留下可运行、可测试的系统状态。
- 每个阶段的数据库变更必须有 migration 和测试。
- 网关核心不得依赖 UI、Fastify route 或具体数据库实现。
- 所有上游调用测试使用 fake upstream，首版不依赖真实供应商。
- 优先做单进程 + SQLite + Docker 友好的实现，不引入 Redis、队列或多服务。
- 计划可以更新，但更新必须写入文档，不只留在聊天记录里。

