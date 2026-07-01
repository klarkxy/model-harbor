import { eq } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import { endpointHealth, type EndpointHealthInsert, type EndpointHealthRow } from '../schema.js';

export class EndpointHealthRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<EndpointHealthRow | undefined> {
    const rows = await this.db
      .select()
      .from(endpointHealth)
      .where(eq(endpointHealth.id, id))
      .limit(1);
    return rows[0];
  }

  async findByEndpointId(endpointId: string): Promise<EndpointHealthRow | undefined> {
    const rows = await this.db
      .select()
      .from(endpointHealth)
      .where(eq(endpointHealth.endpointId, endpointId))
      .limit(1);
    return rows[0];
  }

  async upsert(
    data: Omit<EndpointHealthInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<EndpointHealthRow> {
    const existing = await this.findByEndpointId(data.endpointId);
    const now = new Date();
    if (existing) {
      await this.db
        .update(endpointHealth)
        .set({ ...data, updatedAt: now })
        .where(eq(endpointHealth.id, existing.id));
      return (await this.findById(existing.id))!;
    }
    const row: EndpointHealthInsert = {
      id: generateId('endpointHealth'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(endpointHealth).values(row);
    return row as EndpointHealthRow;
  }

  async deleteByEndpointId(endpointId: string): Promise<void> {
    await this.db.delete(endpointHealth).where(eq(endpointHealth.endpointId, endpointId));
  }
}
