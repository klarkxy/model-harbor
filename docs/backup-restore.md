# 备份与恢复指南

ManageYourLLM 使用 SQLite 保存配置、用量、trace、成本账本和加密后的上游密钥。Backups 是独立运维页面，不属于 Settings。

## 备份类型

### 完整数据库备份

- 包含完整 SQLite 数据库。
- 包含加密后的 provider secret、Client key hash、配置、usage、trace、costs。
- 恢复时必须使用同一个 `MYLLM_SECRET_KEY`。

### 非敏感配置导出

- 用于导出 provider endpoint、Models、Channels、Costs、Settings 等配置骨架。
- 不包含原始 provider secret。
- 不包含 raw Client key。
- 导入后需要重新填写密钥。

## 恢复原则

恢复是高风险操作：

1. 恢复前必须先自动备份当前数据库。
2. 备份文件需要校验 schema version。
3. 恢复完成后提示重启服务。
4. `MYLLM_SECRET_KEY` 不一致时，加密字段无法解密。

## 手动流程

1. 进入 **Backups**。
2. 点击 **Create Backup**。
3. 选择完整备份或非敏感配置导出。
4. 填写备注。
5. 在列表中查看文件名、类型、大小、schema version、备注和创建时间。

## 灾难恢复 checklist

- [ ] 已保存完整数据库备份。
- [ ] 已保存对应的 `MYLLM_SECRET_KEY`。
- [ ] 新环境数据卷已挂载到 `data/`。
- [ ] 新环境使用同一个 secret 启动。
- [ ] 恢复后已重启服务。

## 安全建议

- 不要把完整数据库备份提交到仓库或上传到公开空间。
- `MYLLM_SECRET_KEY` 丢失后无法解密 provider secret。
- 非敏感配置导出也可能暴露内部模型和 endpoint 结构，仍应谨慎分享。
