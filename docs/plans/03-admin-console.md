# 03 Admin Console

Phase 2 实现可配置系统的管理面。目标是能通过 UI 完成首个 provider、模型暴露、Consumer Key 和备份操作。

## 目标

- 本地管理员登录。
- 管理 API。
- Setup Wizard。
- Provider preset 和 upstream key 管理。
- Public model / model group 管理。
- App / Consumer Key 管理。
- 备份/恢复 UI。
- 最小可用管理后台。

## 管理 API 范围

- `/api/admin/auth/*`
- `/api/admin/setup/*`
- `/api/admin/provider-presets`
- `/api/admin/upstream-keys`
- `/api/admin/public-models`
- `/api/admin/model-groups`
- `/api/admin/apps`
- `/api/admin/consumer-keys`
- `/api/admin/settings`
- `/api/admin/backups`

## Setup Wizard

流程：

1. 安全检查。
2. 添加第一个 upstream。
3. 发现模型。
4. 确认 public model 映射。
5. 创建 Consumer Key。
6. 生成测试请求。

Wizard 不直接写数据库，必须调用 application services。

## UI 页面

- Login。
- Setup Wizard。
- Overview。
- Upstream Keys。
- Public Models。
- Model Groups。
- Apps。
- Backups。
- Settings。

## 任务清单

1. 实现 admin auth API 和 session cookie。
2. 实现生产默认 secret/password 拒绝逻辑。
3. 实现 provider preset API，包含内置和本地自定义 preset。
4. 实现 upstream CRUD、排序、discover models、manual ping。
5. 实现 public model CRUD 和 candidate editor。
6. 实现 model group CRUD 和 member editor。
7. 实现 app / consumer key CRUD，默认 `accessMode = all`。
8. 实现 backup create/list/restore/export API。
9. 实现 Setup Wizard UI。
10. 实现管理后台基础页面和 resource composables。

## 验收标准

- 首次启动可创建/确认管理员账号。
- 生产模式默认 secret/password 会阻止启动或显示明确错误。
- 通过 UI 可以添加 PAT upstream key。
- 可以从 provider 拉取模型列表，或手动录入模型。
- 可以创建 public model 和 candidate。
- 可以创建 model group。
- 可以创建 Consumer Key，默认访问全部模型。
- 可以生成完整数据库备份。
- 可以导出非敏感配置。

## 非目标

- 不实现网关请求转发。
- 不实现流式。
- 不实现完整 usage/trace UI。
- 不自动写本机客户端配置文件。

