import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { MaintenanceService } from '../../src/application/maintenance.service.js';
import { ProviderAccountService } from '../../src/application/provider-account.service.js';
import { ClientService } from '../../src/application/client.service.js';
import { SettingsRepository } from '../../src/infrastructure/db/repositories/settings.repository.js';
import { EndpointRepository } from '../../src/infrastructure/db/repositories/endpoint.repository.js';
import { RoutingStateRepository } from '../../src/infrastructure/db/repositories/routing-state.repository.js';
import { ObservabilityRepository } from '../../src/infrastructure/db/repositories/observability.repository.js';
import { AdminUserRepository } from '../../src/infrastructure/db/repositories/admin-user.repository.js';
import { resetEnvForTests } from '../../src/config/env.js';
import { generateId } from '@manageyourllm/shared';

describe('maintenance service', () => {
  let dbFilePath: string;
  let db: import('../../src/infrastructure/db/client.js').Db;
  let client: { close(): Promise<void> };
  let upstreamId: string;
  let clientId: string;
  let clientKeyId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MYLLM_SECRET_KEY = 'test-secret-key-32chars-long!!';
    resetEnvForTests();

    const testDb = await createTestDb();
    db = testDb.db;
    client = testDb.client;
    dbFilePath = testDb.filePath;

    await new SettingsRepository(db).seedDefaultSettings();

    const service = new ProviderAccountService(db, process.env.MYLLM_SECRET_KEY);
    const upstream = await service.createProviderAccount({
      name: 'maintenance-upstream',
      providerType: 'openai_compatible',
      baseUrl: 'https://maint.example.com',
      apiKey: 'sk-maint',
    });
    upstreamId = upstream.id;

    const { client: createdClient } = await new ClientService(db).createClient({
      name: 'maint-app',
      enabled: true,
    });
    clientId = createdClient.id;
    const keys = await new ClientService(db).listClientKeys(clientId);
    clientKeyId = keys[0]!.id;
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await new Promise((r) => setTimeout(r, 100));
    await rm(dirname(dbFilePath), {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }, 60_000);

  it('deletes stale breakers in expired cooldown', async () => {
    // v1 Phase 5 收口后 cooldown 仅由 circuit_breakers 行表达。
    // 模拟一个 open 且 cooldown 已过期、updatedAt 也已过期的旧 breaker 等待清理。
    const routingRepo = new RoutingStateRepository(db);
    const endpointRepo = new EndpointRepository(db);
    const endpoints = await endpointRepo.listByProviderAccount(upstreamId);
    const endpointId = endpoints[0]!.id;
    await routingRepo.upsertBreaker({
      providerAccountId: upstreamId,
      endpointId,
      realModelName: 'model',
      state: 'open',
      failureCount: 5,
      successCount: 0,
      openCount: 1,
      cooldownUntil: new Date(Date.now() - 60_000),
      openedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 - 60_000),
      lastErrorCode: 'rate_limit',
      lastErrorMessage: 'rate limited',
    });

    // 倒推 updatedAt 26h，使 deleteStaleBreakers 的"updatedAt < 24h ago"条件严格成立。
    const { circuitBreakers } = await import('../../src/infrastructure/db/schema.js');
    const { and, eq } = await import('drizzle-orm');
    await db
      .update(circuitBreakers)
      .set({ updatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000) })
      .where(and(eq(circuitBreakers.providerAccountId, upstreamId)));

    const maintenance = new MaintenanceService({ db });
    await maintenance.run();

    const breaker = await routingRepo.findBreaker(upstreamId, 'model', endpointId);
    expect(breaker).toBeUndefined();
  });

  it('deletes expired sticky bindings', async () => {
    const routingRepo = new RoutingStateRepository(db);
    const longAgo = new Date(Date.now() - 60_000);
    // use the real client and client key created in beforeAll
    const fingerprint = 'fp-1';
    await routingRepo.upsertStickyBinding({
      clientId: clientId,
      clientKeyId: clientKeyId,
      requestedTargetName: 'expired-binding',
      conversationFingerprint: fingerprint,
      providerAccountId: upstreamId,
      realModelName: 'model',
      expiresAt: longAgo,
      lastUsedAt: longAgo,
    });

    const maintenance = new MaintenanceService({ db });
    await maintenance.run();

    const found = await routingRepo.findStickyBinding(
      clientId,
      clientKeyId,
      'expired-binding',
      fingerprint,
    );
    expect(found).toBeUndefined();
  });

  it('deletes old trace logs', async () => {
    const obsRepo = new ObservabilityRepository(db);
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const requestTraceId = generateId('trace');
    await obsRepo.insertTraceLog({
      requestTraceId,
      step: 'old_event',
      stepIndex: 0,
      clientId: generateId('client'),
      clientKeyId: generateId('clientKey'),
      requestedTargetName: 'old-target',
      createdAt: old,
    });

    const maintenance = new MaintenanceService({ db });
    await maintenance.run();

    const logs = await obsRepo.listTraceLogsByRequestTraceId(requestTraceId);
    expect(logs.length).toBe(0);
  });

  it('deletes expired admin sessions', async () => {
    const adminRepo = new AdminUserRepository(db);
    const admin = await adminRepo.createAdmin({
      username: 'maint-admin',
      passwordHash: 'hash',
      displayName: 'Maint',
    });
    const expired = new Date(Date.now() - 60_000);
    await adminRepo.createSession({
      adminUserId: admin.id,
      sessionHash: 'expired-session',
      expiresAt: expired,
      lastSeenAt: expired,
    });

    const maintenance = new MaintenanceService({ db });
    await maintenance.run();

    const found = await adminRepo.findSessionByHash('expired-session');
    expect(found).toBeUndefined();
  });
});
