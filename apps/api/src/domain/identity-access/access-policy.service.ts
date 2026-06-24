import type { Db } from '../../infrastructure/db/client.js';
import { ConsumerKeyRepository } from '../../infrastructure/db/repositories/consumer-key.repository.js';
import { TargetRepository } from '../../infrastructure/db/repositories/target.repository.js';
import type { ConsumerKeyRow, TargetType } from '../../infrastructure/db/schema.js';

export interface AccessCheckResult {
  allowed: boolean;
  consumerKey: ConsumerKeyRow;
  targetType?: TargetType;
  targetId?: string;
}

export class AccessPolicyService {
  constructor(private readonly db: Db) {}

  // 检查 consumer key 是否有权访问目标名称。
  // 若 accessMode = all 则放行；若为 restricted 则必须在 consumer_key_access 中命中。
  async checkAccess(
    consumerKey: ConsumerKeyRow,
    requestedTargetName: string,
  ): Promise<AccessCheckResult> {
    if (!consumerKey.enabled || consumerKey.revokedAt) {
      return { allowed: false, consumerKey };
    }

    if (consumerKey.accessMode === 'all') {
      const target = await new TargetRepository(this.db).findByName(requestedTargetName);
      return {
        allowed: !!target,
        consumerKey,
        targetType: target?.targetType,
        targetId: target?.targetId,
      };
    }

    const target = await new TargetRepository(this.db).findByName(requestedTargetName);
    if (!target) {
      return { allowed: false, consumerKey };
    }

    const accessList = await new ConsumerKeyRepository(this.db).listAccessByKey(consumerKey.id);
    const granted = accessList.some(
      (a) => a.targetType === target.targetType && a.targetId === target.targetId,
    );
    return {
      allowed: granted,
      consumerKey,
      targetType: target.targetType,
      targetId: target.targetId,
    };
  }
}
