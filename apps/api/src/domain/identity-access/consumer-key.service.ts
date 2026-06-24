import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../../infrastructure/db/client.js';
import { ConsumerKeyRepository } from '../../infrastructure/db/repositories/consumer-key.repository.js';
import { withTransaction } from '../../infrastructure/db/unit-of-work.js';
import { type ConsumerKeyRow, type TargetType } from '../../infrastructure/db/schema.js';

export interface RawConsumerKey {
  consumerKey: ConsumerKeyRow;
  rawKey: string;
}

export interface CreateConsumerKeyInput {
  appId: string;
  name: string;
  accessMode?: 'all' | 'restricted';
  accessTargets?: Array<{ targetType: TargetType; targetId: string }>;
  enabled?: boolean;
}

function generateRawKey(): string {
  return `ck_${randomBytes(24).toString('base64url')}`;
}

function hashRawKey(rawKey: string): { keyHash: string; keyPrefix: string; keySuffix: string } {
  const keyHash = createHash('sha256').update(rawKey).digest('base64url');
  return {
    keyHash,
    keyPrefix: rawKey.slice(0, 4),
    keySuffix: rawKey.slice(-4),
  };
}

export class ConsumerKeyService {
  constructor(private readonly db: Db) {}

  private repository(): ConsumerKeyRepository {
    return new ConsumerKeyRepository(this.db);
  }

  async createConsumerKey(input: CreateConsumerKeyInput): Promise<RawConsumerKey> {
    const rawKey = generateRawKey();
    const { keyHash, keyPrefix, keySuffix } = hashRawKey(rawKey);

    const consumerKey = await withTransaction(this.db, async (tx) => {
      const repo = new ConsumerKeyRepository(tx);
      const key = await repo.createConsumerKey({
        appId: input.appId,
        name: input.name,
        keyHash,
        keyPrefix,
        keySuffix,
        accessMode: input.accessMode ?? 'all',
        enabled: input.enabled ?? true,
      });

      if (
        input.accessMode === 'restricted' &&
        input.accessTargets &&
        input.accessTargets.length > 0
      ) {
        await repo.replaceAccess(
          key.id,
          input.accessTargets.map((t) => ({ targetType: t.targetType, targetId: t.targetId })),
        );
      }

      return key;
    });

    return { consumerKey, rawKey };
  }

  async rotateConsumerKey(id: string): Promise<RawConsumerKey> {
    const rawKey = generateRawKey();
    const { keyHash, keyPrefix, keySuffix } = hashRawKey(rawKey);
    const repo = this.repository();
    const consumerKey = await repo.updateConsumerKey(id, {
      keyHash,
      keyPrefix,
      keySuffix,
      revokedAt: null,
    });
    if (!consumerKey) {
      throw new Error('Consumer key not found');
    }
    return { consumerKey, rawKey };
  }

  async revokeConsumerKey(id: string): Promise<ConsumerKeyRow | undefined> {
    return this.repository().updateConsumerKey(id, { revokedAt: new Date(), enabled: false });
  }

  async verifyRawKey(rawKey: string): Promise<ConsumerKeyRow | undefined> {
    const { keyHash } = hashRawKey(rawKey);
    return this.repository().findByKeyHash(keyHash);
  }
}
