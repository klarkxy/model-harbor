import { eq, count } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  clients,
  clientKeys,
  type ClientInsert,
  type ClientRow,
  type ClientKeyInsert,
  type ClientKeyRow,
} from '../schema.js';

export class ClientRepository {
  constructor(private readonly db: Db) {}

  async createClient(
    data: Omit<ClientInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ClientRow> {
    const now = new Date();
    const row: ClientInsert = {
      id: generateId('client'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(clients).values(row);
    return row as ClientRow;
  }

  async findById(id: string): Promise<ClientRow | undefined> {
    const rows = await this.db.select().from(clients).where(eq(clients.id, id)).limit(1);
    return rows[0];
  }

  async findByName(name: string): Promise<ClientRow | undefined> {
    const rows = await this.db.select().from(clients).where(eq(clients.name, name)).limit(1);
    return rows[0];
  }

  async listClients(): Promise<ClientRow[]> {
    return this.db.select().from(clients).orderBy(clients.name);
  }

  async updateClient(
    id: string,
    data: Partial<Omit<ClientInsert, 'id' | 'createdAt'>>,
  ): Promise<ClientRow | undefined> {
    const now = new Date();
    await this.db
      .update(clients)
      .set({ ...data, updatedAt: now })
      .where(eq(clients.id, id));
    return this.findById(id);
  }

  async deleteClient(id: string): Promise<void> {
    await this.db.delete(clients).where(eq(clients.id, id));
  }

  // ---- Client Key 内部实现（原 ConsumerKeyRepository）----

  async createClientKey(
    data: Omit<ClientKeyInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ClientKeyRow> {
    const now = new Date();
    const row: ClientKeyInsert = {
      id: generateId('clientKey'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(clientKeys).values(row);
    return row as ClientKeyRow;
  }

  async findClientKeyById(id: string): Promise<ClientKeyRow | undefined> {
    const rows = await this.db.select().from(clientKeys).where(eq(clientKeys.id, id)).limit(1);
    return rows[0];
  }

  async findClientKeyByHash(keyHash: string): Promise<ClientKeyRow | undefined> {
    const rows = await this.db
      .select()
      .from(clientKeys)
      .where(eq(clientKeys.keyHash, keyHash))
      .limit(1);
    return rows[0];
  }

  async listClientKeys(clientId: string): Promise<ClientKeyRow[]> {
    return this.db
      .select()
      .from(clientKeys)
      .where(eq(clientKeys.clientId, clientId))
      .orderBy(clientKeys.createdAt);
  }

  async hasClientKeys(): Promise<boolean> {
    const rows = await this.db.select({ count: count() }).from(clientKeys);
    return (rows[0]?.count ?? 0) > 0;
  }

  async updateClientKey(
    id: string,
    data: Partial<Omit<ClientKeyInsert, 'id' | 'createdAt'>>,
  ): Promise<ClientKeyRow | undefined> {
    const now = new Date();
    await this.db
      .update(clientKeys)
      .set({ ...data, updatedAt: now })
      .where(eq(clientKeys.id, id));
    return this.findClientKeyById(id);
  }

  async touchClientKeyLastUsed(id: string, at = new Date()): Promise<void> {
    await this.db
      .update(clientKeys)
      .set({ lastUsedAt: at, updatedAt: at })
      .where(eq(clientKeys.id, id));
  }

  async deleteClientKey(id: string): Promise<void> {
    await this.db.delete(clientKeys).where(eq(clientKeys.id, id));
  }
}
