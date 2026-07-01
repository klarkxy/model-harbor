import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ClientRepository } from '../../src/infrastructure/db/repositories/client.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('client repository', () => {
  let testDb: TestDb;
  let repo: ClientRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new ClientRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('CRUD clients', async () => {
    const created = await repo.createClient({
      name: 'Test App',
      description: 'desc',
      enabled: true,
    });
    expect(created.name).toBe('Test App');

    const found = await repo.findById(created.id);
    expect(found).toBeDefined();

    const updated = await repo.updateClient(created.id, { description: 'updated' });
    expect(updated!.description).toBe('updated');

    await repo.deleteClient(created.id);
    const after = await repo.findById(created.id);
    expect(after).toBeUndefined();
  });

  it('finds by name', async () => {
    await repo.createClient({ name: 'Named App', enabled: true });
    const found = await repo.findByName('Named App');
    expect(found).toBeDefined();
  });
});
