import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import {
  createDb,
  initSchema,
  type Db,
} from '../src/modules/db/index.js';
import {
  apps,
  consumerKeyAccess,
  consumerKeys,
  modelGroupMembers,
  modelGroups,
  publicModels,
  targetNames,
  upstreamKeys,
} from '../src/modules/db/schema.js';
import { bootstrapAdmin, SESSION_COOKIE } from '../src/modules/auth/index.js';
import { encryptUpstreamApiKey, generateConsumerKeyRaw } from '../src/modules/admin/index.js';
import { generateId } from '@modelharbor/shared';

export interface AdminTestRig {
  app: FastifyInstance;
  db: Db;
  secretKey: string;
  cookie: string;
  close: () => Promise<void>;
}

const TEST_SECRET = 'test-secret-key-for-m2';

function freshTestDbPath(): string {
  // Use a temp file (not :memory:) so Drizzle transactions share a connection.
  return join(tmpdir(), `mh-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.db`);
}

export async function makeAdminRig(): Promise<AdminTestRig> {
  const dbFile = freshTestDbPath();
  const { db, client } = createDb({ url: `file:${dbFile}` });
  await initSchema(db);
  await bootstrapAdmin(db, { username: 'admin', password: 'secret123', displayName: 'Admin' });
  const app = await buildServer({
    db,
    logger: false,
    isProduction: false,
    secretKey: TEST_SECRET,
    disableBackgroundJobs: true,
  });
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: { username: 'admin', password: 'secret123' },
  });
  const setCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie as string]).find((c) =>
    c.startsWith(`${SESSION_COOKIE}=`),
  )!;
  return {
    app,
    db,
    secretKey: TEST_SECRET,
    cookie,
    close: async () => {
      await app.close();
      client.close();
      try {
        unlinkSync(dbFile);
      } catch {
        /* ignore */
      }
    },
  };
}

export interface SeedRefs {
  upstreamKeyId: string;
  upstreamKeyName: string;
  rawApiKey: string;
  appId: string;
  publicModelId: string;
  modelGroupId: string;
  consumerKeyId: string;
  rawConsumerKey: string;
}

export async function seedFullRoute(rig: AdminTestRig): Promise<SeedRefs> {
  const now = new Date();
  const rawApiKey = 'sk-test-supersecret-9876543210';
  const ukId = generateId('upstreamKey');
  const enc = encryptUpstreamApiKey(rawApiKey, rig.secretKey);
  await rig.db.insert(upstreamKeys).values({
    id: ukId,
    name: 'Test upstream',
    providerType: 'anthropic_compatible',
    baseUrl: 'https://api.example.com',
    apiKeyCiphertext: enc.ciphertext,
    apiKeyPrefix: enc.prefix,
    supportedModelsJson: JSON.stringify(['ds-v4-flash']),
    enabled: true,
    frozen: false,
    createdAt: now,
    updatedAt: now,
  });

  const appId = generateId('app');
  await rig.db.insert(apps).values({
    id: appId,
    name: 'Test app',
    description: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });

  const pmId = generateId('publicModel');
  await rig.db.insert(publicModels).values({
    id: pmId,
    name: 'ds-v4-flash',
    displayName: 'DS V4 Flash',
    description: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  await rig.db.insert(targetNames).values({
    id: `tn_${ukId.slice(-6)}`,
    name: 'ds-v4-flash',
    targetType: 'public_model',
    targetId: pmId,
    createdAt: now,
  });

  const mgId = generateId('modelGroup');
  await rig.db.insert(modelGroups).values({
    id: mgId,
    name: 'coding',
    displayName: 'Coding',
    description: null,
    enabled: true,
    routingPolicy: 'priority',
    createdAt: now,
    updatedAt: now,
  });
  await rig.db.insert(targetNames).values({
    id: `tn_${mgId.slice(-6)}`,
    name: 'coding',
    targetType: 'model_group',
    targetId: mgId,
    createdAt: now,
  });
  await rig.db.insert(modelGroupMembers).values({
    id: generateId('modelGroup') + '_m',
    modelGroupId: mgId,
    publicModelId: pmId,
    enabled: true,
    priority: 100,
    weight: 1,
    createdAt: now,
    updatedAt: now,
  });

  const ck = generateConsumerKeyRaw();
  const ckId = generateId('consumerKey');
  await rig.db.insert(consumerKeys).values({
    id: ckId,
    appId,
    name: 'Test key',
    keyHash: ck.hash,
    keyPrefix: ck.prefix,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  await rig.db.insert(consumerKeyAccess).values({
    id: generateId('consumerKey') + '_a',
    consumerKeyId: ckId,
    targetType: 'public_model',
    targetId: pmId,
    createdAt: now,
  });
  await rig.db.insert(consumerKeyAccess).values({
    id: generateId('consumerKey') + '_a',
    consumerKeyId: ckId,
    targetType: 'model_group',
    targetId: mgId,
    createdAt: now,
  });

  return {
    upstreamKeyId: ukId,
    upstreamKeyName: 'Test upstream',
    rawApiKey,
    appId,
    publicModelId: pmId,
    modelGroupId: mgId,
    consumerKeyId: ckId,
    rawConsumerKey: ck.raw,
  };
}
