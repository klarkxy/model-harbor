# ManageYourLLM 代码与文档设计一致性审校报告

> 审校时间：2026-07-01
> 审校范围：`apps/api/src`、`apps/web/src`、契约包、测试、e2e
> 基准文档：`docs/architecture-rebuild.md`、`docs/product-decisions.md`、`docs/v1-closure.md`、`docs/v1-construction-todo.md`
> 审校方式：只读探索 + 实际运行质量门禁命令

---

## 总体判断

当前代码与文档设计在**后端核心概念与主链路**上基本一致，但**未达到 `docs/v1-construction-todo.md` Phase 10 所宣称的“全部收口、质量门禁全绿”状态**。

- **一致**：Provider Account / Endpoint / Model / Channel / Client 的新概念边界、数据库表迁移、routing/gateway 主链路、Snapshot 机制、candidate 级 breaker、错误分类、左侧导航 5 分组、Models 三 tab、Backups 独立页等已落地。
- **偏离/未落地**：前端缺少 Endpoint 管理 UI、Setup Wizard 未完成网关测试闭环、Settings 缺内容日志开关、若干路由/过滤逻辑存在 bug、旧命名未清干净、质量门禁未全绿。

---

## 一、架构与数据模型

### 1.1 核心对象边界（基本一致）

| 维度 | 结论 | 关键依据 |
|---|---|---|
| Provider Preset 只读模板，Provider Account 可编辑 | ✅ | `provider-preset.repository.ts:31`、`provider-account.service.ts:59` |
| Endpoint 是一等对象 | ✅ | `schema.ts:826`、`endpoint.repository.ts`、`endpoint.service.ts`、`/admin/endpoints` 路由全套存在 |
| Model candidate 指向 `providerAccountId + endpointId + realModelName` | ✅ | `schema.ts:330`、`model.service.ts:207` |
| Channel 是有序 Model 集合，无加权/轮询 | ✅ | `schema.ts:380`、`routing-decision.service.ts:168` |
| Client 创建时自动生成 active key | ✅ | `client.service.ts:69`、`clients.ts:51` |

### 1.2 明显问题

| 问题 | 严重度 | 说明 |
|---|---|---|
| **从 preset 创建 Provider Account 时，默认 endpoint 被标为 `source: 'user'`** | 中 | `provider-account.service.ts:110` 硬编码 `source: 'user'` 且 `isPresetDefault: false`，后续“恢复模板默认”语义被破坏 |
| **ConsumerKeyService / ConsumerKeyRepository 仍是独立类** | 高 | 文档要求降级为 Client 实现细节，但 `apps/api/src/application/consumer-key.service.ts` 与 `consumer-key.repository.ts` 仍独立存在，14+ 测试仍直接 import |
| **DB 未强制“一个 Client 只有一个 active key”** | 中 | `consumerKeys` 表支持多行未吊销，`ClientService.requireActiveKey` 只取第一个 |
| **Phase 10 应删的兼容字段仍在 schema** | 中 | `modelCandidates.endpointUrl`、`models.candidateOrderCustomized`、`stickyBindings.endpointUrl`、`stickySessions.endpointUrl`、`providerAccounts.baseUrl` |
| **ID 前缀仍是旧名** | 低 | `generateId('upstreamKey')`、`ukq`/`ukc`、`ep_` 硬编码 |
| **Costs 底层仍是 pricing_entries / plans 两张独立表** | 低 | 与文档“合并为 costs 相关表/视图”未完全达成 |

---

## 二、路由与网关

### 2.1 主链路（一致）

| 检查项 | 结论 | 依据 |
|---|---|---|
| 网关 base path 固定 `/v1` | ✅ | `build-server.ts:36` |
| 支持 4 个入口 | ✅ | `/v1/models`、`/v1/chat/completions`、`/v1/responses`、`/v1/messages` |
| Model/Channel 解析、顺序 failover | ✅ | `target-resolution.service.ts`、`routing-decision.service.ts`、`gateway-execution.service.ts` |
| 错误分类正确 | ✅ | 4xx/auth/permission/model_not_found 不计入 breaker；5xx/rate_limit/quota/timeout/overloaded/网络错误计入 |
| Trace 记录解析/展开/过滤/尝试/结果 | ✅ | `routing-decision.service.ts`、`gateway-execution.service.ts` |

### 2.2 关键逻辑 bug（需要修复）

| 问题 | 严重度 | 说明 |
|---|---|---|
| **per-candidate cooldown 对 `state='closed'` 不生效** | 🔴 高 | `setCandidateCooldown` 会写入 `closed + cooldownUntil`，但 `routing-decision.service.ts:366` 只在 `state === 'open'` 时检查，导致失败次数未达阈值时的 cooldown 完全失效 |
| **disabled Model / Channel 不在路由层拦截** | 🔴 高 | `expandModel` 未检查 `model.enabled`，`expandChannel` 未检查 `channel.enabled`，只要 candidate/member enabled 就仍能被请求 |
| **原生端点高级能力被静默丢弃** | 🟡 中 | parser/adapter 只透传基础字段，tools/vision/response_format 等在同协议原生 endpoint 上被放行后截断 |
| **Trace 部分事件缺少 `endpointId`** | 🟡 中 | `filter_breaker_open`、`upstream_attempt_failed` 只写 `providerAccountId`，影响按 endpoint 过滤 Trace 的完整性 |

---

## 三、前端信息架构

### 3.1 已落地（一致）

| 检查项 | 结论 |
|---|---|
| 左侧导航 5 分组 | ✅ `AdminLayout.vue:29` |
| Models 三 tab | ✅ `Models.vue:214` |
| Backups 独立页面 | ✅ `Backups.vue`、`router/index.ts:66` |
| Costs 合并 pricing/plans | ✅ `Costs.vue:387` |
| Traces 含 Debug Content tab | ✅ `Traces.vue:361` |
| Clients 含 snippet / rotate / usage / trace 跳转 | ✅ `Clients.vue:128` |

### 3.2 明显缺口与 bug

| 问题 | 严重度 | 说明 |
|---|---|---|
| **Providers 页面缺少 Endpoint 管理 UI** | 🔴 高 | `ProviderAccounts.vue` 只有账号级 `baseUrl` 表单，无 endpoint 列表/新增/编辑/禁用/恢复 preset/health 展示；与文档要求严重不符 |
| **Setup Wizard 未完成闭环** | 🔴 高 | 无 endpoint ping 步骤、无自动网关测试、`finish()` 无条件跳转 overview、失败不阻塞 |
| **Setup Wizard 仅生成 cURL，无 OpenAI/Anthropic SDK 片段** | 🟡 中 | 与文档“复制配置片段”要求偏离 |
| **`Traces.vue:248` 引用已删除的 `'channels'` 路由名** | 🟡 中 | 会导致 `router.push` 抛 `No match found for name "channels"` |
| **Settings 页缺少临时内容日志开关** | 🟡 中 | 后端契约与 DB 已有字段，但 UI 未暴露 |
| **i18n 旧术语残留** | 🟡 中 | `setup.consumerKey`、`usage.byApp/byConsumerKey/byUpstream`、`modelReference.upstreamKey`、`breaker` 文案等未迁移 |

---

## 四、Setup Wizard 闭环

| 文档要求 | 实现状态 |
|---|---|
| 创建管理员 | ✅ |
| 创建 Provider Account | ✅ |
| 配置/确认 Endpoint | ❌ 无 endpoint 步骤/UI |
| Endpoint ping 成功 | ❌ 无 ping 步骤 |
| 发现/手动创建 Model | ✅（手动） |
| 创建 Client 和 key | ✅ |
| 展示 SDK 配置片段 | ❌ 仅 cURL |
| 网关测试成功后才允许完成 | ❌ 不测试、不阻塞 |
| 失败时留在当前步骤并展示 trace | ❌ |

---

## 五、质量门禁实测结果

| 命令 | 结果 | 说明 |
|---|---|---|
| `pnpm typecheck` | ✅ 通过 | 4 个 workspace 全绿 |
| `pnpm lint` | ✅ 通过 | `sub2api/` 已忽略 |
| `pnpm test` | ❌ 失败 | `apps/api/test/routes/admin/management.test.ts:53` 期望 `app_` 前缀，实际 ID 已是 `cli_`；264/265 通过 |
| `pnpm build` | ✅ 通过 | web 有 chunk 体积警告 |
| `pnpm format:check` | ❌ 失败 | `apps/api/test/repositories/client.repository.test.ts` 未格式化 |
| `pnpm e2e` | ❌ 失败 | `admin-happy-path.spec.ts:101` 连接拒绝 `127.0.0.1:3001`，`tsx watch` 重启窗口导致 flaky |

**结论**：Phase 10 声称的“typecheck / lint / format:check / test / build / e2e 全部通过”与当前代码状态不符。

---

## 六、修复建议（按优先级）

### 🔴 高优先级

1. **修复 routing 层两个过滤 bug**
   - `closed + cooldownUntil` 的 candidate 也应被过滤，并补 `filter_cooldown` trace 事件。
   - `expandModel` / `expandChannel` 前增加 `enabled` 检查。

2. **补齐 Endpoint 管理 UI**
   - 在 `ProviderAccounts.vue` 中增加 endpoint 列表、新增/编辑/禁用/恢复 preset/health 展示，或新增独立 `/endpoints` 子页面。

3. **完成 Setup Wizard 闭环**
   - 增加 endpoint ping 步骤。
   - 增加自动网关测试步骤，失败时阻塞 `finish()` 并展示 trace/错误/返回修改入口。
   - 提供 OpenAI / Anthropic / cURL 配置片段。

4. **修复质量门禁**
   - 修 `management.test.ts:53` 的 `app_` → `cli_` 断言。
   - 跑 `pnpm format`。
   - 将 e2e 的 API server 改为非 watch 模式，消除 flaky。

### 🟡 中优先级

5. **Settings 页增加内容日志开关**（`contentLogEnabled` / `contentLogMaxRows` / `contentLogRetentionDays` / `contentLogMaxPayloadBytes`）。
6. **真正收敛 ConsumerKey**：将 `ConsumerKeyService` / `ConsumerKeyRepository` 合并进 `ClientService` / `ClientRepository`，删除独立文件与旧表。
7. **清理旧命名**：ID 前缀、DB 列名、setup/resilience/e2e 中的 `upstreamKeyId` / `consumer-key` / `appId`。
8. **清理 Phase 10 应删的兼容字段**。
9. **修复 `Traces.vue:248` 对已删除 `'channels'` 路由的引用**。
10. **明确原生端点高级能力策略**：透传或明确拒绝，避免静默丢失。

---

## 七、结论

ManageYourLLM 的**后端主链路架构与文档设计基本对齐**，已具备 v1 的核心骨架；但**前端功能缺口较大**（Endpoint 管理、Setup Wizard 闭环、Settings 内容日志），**路由层有两个影响正确性的 bug**（cooldown 未生效、disabled 目标未拦截），**质量门禁也未全绿**，且 Phase 10 宣称的“旧概念全部清理”并未真正完成。建议先修复高优先级问题，再重新跑通 `pnpm test` / `pnpm format:check` / `pnpm e2e`。
