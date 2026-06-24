# 06 Observability & Cost

Phase 5 完成日常自用所需的排障、用量、成本、套餐和模型参考能力。

## 目标

- Usage dashboard。
- Trace detail。
- Daily consumption stats。
- Temporary debug content logs。
- Personal Cost & Plan Ledger。
- Model reference board。
- Client configuration snippets。
- 运维和部署文档完善。

## Usage & Trace

页面能力：

- 今日请求总数。
- 成功率。
- 错误率。
- token 总量。
- sticky 命中率。
- 按 app / consumer key / upstream / target 分组。
- 最近请求。
- trace 时间线。
- 从 trace 跳转 upstream key / public model。

Trace 必须回答：

- 请求目标解析成了什么。
- 哪些候选被展开。
- 哪些候选被过滤，原因是什么。
- sticky 是否命中。
- 尝试了哪些候选。
- 每个候选为什么失败。
- 最终为什么成功或失败。

## Temporary Debug Content Logs

规则：

- 默认关闭。
- 手动开启。
- 短窗口或最近 N 条。
- 自动关闭。
- 脱敏、截断。
- UI 明显提示正在记录内容。

## Cost & Plan Ledger

功能：

- provider/model 定价。
- cost multiplier。
- 请求成本估算。
- 日/月成本统计。
- token plan / coding plan 记录。
- 购买时间、到期时间、周期额度、手动剩余额度。
- 续费提醒。

预留：

- 预算阈值。
- 余额优先路由。
- 成本优先智能策略。

## Model Reference Board

首版：

- 固定内置来源。
- 展示分数、价格、上下文、速度、延迟。
- 支持筛选和排序。
- 生成 public model / model group 推荐。
- 推荐需要用户确认。

不做：

- 用户自定义榜单来源。
- 实时路由自动使用榜单。

## Client Configuration Snippets

首版支持：

- Claude Code。
- Codex 类客户端。
- OpenCode。
- Hermes。
- Cherry Studio。
- 通用 OpenAI-compatible 客户端。

只生成可复制片段，不自动写配置文件。

## 任务清单

1. 实现 usage aggregation API。
2. 实现 trace list/detail API 和 UI。
3. 实现 daily consumption stats UI。
4. 实现 temporary debug content log。
5. 实现 pricing 和 cost ledger API。
6. 实现 token/coding plan UI。
7. 实现续费提醒。
8. 实现 model reference fetcher 和 board。
9. 实现 recommendation -> config draft。
10. 实现 client configuration snippets。
11. 完善 Docker、备份、恢复、公网部署文档。

## 验收标准

- 可以从最近请求进入 trace 时间线。
- 可以看出一次 failover 的完整过程。
- 可以看到每日 token 和成本。
- 可以记录一个 coding/token plan，并看到到期提醒。
- 可以从模型参考榜单生成配置草稿。
- 可以复制 Claude Code / Codex / OpenCode / Hermes / Cherry Studio 配置片段。
- 临时内容调试模式会自动关闭。

