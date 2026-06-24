import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { withTransaction } from '../../src/infrastructure/db/unit-of-work.js';
import { apps } from '../../src/infrastructure/db/schema.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('unit of work', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('commits successful transaction', async () => {
    await withTransaction(testDb.db, async (tx) => {
      await tx.insert(apps).values({
        id: 'app_1',
        name: 'committed',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const rows = await testDb.db.select().from(apps).where(eq(apps.id, 'app_1'));
    expect(rows).toHaveLength(1);
  });

  it('rolls back failed transaction', async () => {
    await expect(
      withTransaction(testDb.db, async (tx) => {
        await tx.insert(apps).values({
          id: 'app_2',
          name: 'rolled-back',
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        throw new Error('intentional failure');
      }),
    ).rejects.toThrow('intentional failure');

    const rows = await testDb.db.select().from(apps).where(eq(apps.id, 'app_2'));
    expect(rows).toHaveLength(0);
  });
});
