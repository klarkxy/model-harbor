import type { Db } from '../infrastructure/db/client.js';
import { TargetRepository } from '../infrastructure/db/repositories/target.repository.js';
import type { ClientKeyRow, TargetType } from '../infrastructure/db/schema.js';

export interface AccessCheckResult {
  allowed: boolean;
  clientKey: ClientKeyRow;
  targetType?: TargetType;
  targetId?: string;
}

/**
 * v1 Phase 6 收口：access policy 完全简化。
 * 客户端 key 永远是 `accessMode: 'all'`，不做 restricted 模式。
 * 仅做两件事：
 * 1. 检查 key 是否启用且未被吊销。
 * 2. 检查请求的目标名是否已注册。
 */
export class AccessPolicyService {
  constructor(private readonly db: Db) {}

  async checkAccess(
    clientKey: ClientKeyRow,
    requestedTargetName: string,
  ): Promise<AccessCheckResult> {
    if (!clientKey.enabled || clientKey.revokedAt) {
      return { allowed: false, clientKey };
    }

    const target = await new TargetRepository(this.db).findByName(requestedTargetName);
    return {
      allowed: !!target,
      clientKey,
      targetType: target?.targetType,
      targetId: target?.targetId,
    };
  }
}
