import type { ClientKeyRow } from '../../infrastructure/db/schema.js';
import { serializeForContract } from './contract-serializer.js';

// Phase 10 收口：DB 形态 `ClientKeyRow.clientId` 已与 v1 contract 形态 `ClientKeyContract.clientId` 对齐。
// 返回已经过 serializeForContract 处理的对象（Date → ISO string），可直接供 zod parse 使用。
//
// 注意：明确剥离 `access` 字段——内部访问控制数据不应出现在 wire 上。不依赖 zod 的 strip 行为。
export function clientKeyRowToContract(row: ClientKeyRow): Record<string, unknown> {
  const { access: _access, ...rest } = row as ClientKeyRow & { access?: unknown };
  return serializeForContract(rest);
}
