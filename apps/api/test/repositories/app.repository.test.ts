import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { AppRepository } from '../../src/infrastructure/db/repositories/app.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('app repository', () => {
  let testDb: TestDb;
  let repo: AppRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new AppRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('CRUD apps', async () => {
    const created = await repo.createApp({ name: 'Test App', description: 'desc', enabled: true });
    expect(created.name).toBe('Test App');

    const found = await repo.findById(created.id);
    expect(found).toBeDefined();

    const updated = await repo.updateApp(created.id, { description: 'updated' });
    expect(updated!.description).toBe('updated');

    await repo.deleteApp(created.id);
    const after = await repo.findById(created.id);
    expect(after).toBeUndefined();
  });

  it('finds by name', async () => {
    await repo.createApp({ name: 'Named App', enabled: true });
    const found = await repo.findByName('Named App');
    expect(found).toBeDefined();
  });
});
