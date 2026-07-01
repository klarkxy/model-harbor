# v1.0.0 闭环规格

v1.0.0 只追求一条主链路稳定、可解释、可恢复。任何不服务这条链路的复杂能力都后移。

## 完成定义

从空数据库启动后，用户必须能完成：

```text
Setup Wizard
  -> 创建管理员
  -> 创建 Provider Account
  -> 配置并测试 Endpoint
  -> 发现或手动创建 Model
  -> 可选创建 Channel
  -> 创建 Client 和 key
  -> 复制配置片段
  -> 网关测试请求成功
  -> 查看 Usage / Trace
  -> 创建完整备份
```

## 必须改到位的设计债

1. 左侧导航按新分组重排。
2. Upstream Keys 页面重命名并重塑为 Providers。
3. Public Models / Model Groups / Model Reference 聚合为 Models 页面三 tab。
4. Apps 简化为 Clients：一个 Client 一个 active key，不做权限。
5. Debug Content Logs 合入 Traces。
6. Pricing / Plans 合并为 Costs。
7. Backups 独立页面恢复，不放 Settings。
8. Settings 只保留系统参数。
9. `gatewayBasePath` 固定为 `/v1`，删除半可配置状态。
10. cooldown / breaker 迁移到 candidate endpoint 级别。

## 验收路径

### 1. Setup Wizard

- 空库访问 Web 自动进入 Setup。
- 创建管理员。
- 选择 provider preset 或手动 provider。
- 至少一个 endpoint ping 成功。
- 发现模型或手动填入 real model。
- 创建 Model。
- 创建 Client 并展示 raw key。
- 使用 fake upstream 通过 `/v1/chat/completions` 或 `/v1/messages` 成功请求。

### 2. Provider / Endpoint

- 一个 Provider Account 可包含多个 Endpoint。
- Endpoint 可新增、禁用、删除、覆盖 base URL。
- 可恢复模板默认 endpoint。
- Endpoint health 按 endpoint 展示。

### 3. Model / Channel

- Model candidate 按用户顺序尝试。
- Channel 按有序 Model 列表展开。
- Candidate 状态能显示健康、最近错误、breaker/cooldown。

### 4. Client

- Client 创建即生成 active key。
- Rotate key 后旧 key 失效，新 key 只展示一次。
- 配置片段包含 OpenAI-compatible、Anthropic-compatible、cURL。

### 5. Trace / Usage

- Trace 能展示：目标解析、候选展开、过滤原因、每次尝试、最终结果。
- breaker/cooldown 跳过必须出现在 trace。
- Usage 能看到请求数、token、成本估算和关联 Client / Model。

### 6. Backup

- 能创建完整数据库备份。
- 恢复前自动备份当前库。
- 恢复后提示需要重启。
- 非敏感配置导出不包含原始 secret。

## 后移

- Client type。
- 模型权限。
- weighted / round-robin / cost-aware / quality-aware routing。
- 自定义榜单来源。
- 自动写客户端配置。
- 多用户组织能力。
