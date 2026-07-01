import type { FastifyInstance } from 'fastify';
import { adminAuthRoutes, type AdminAuthRouteDeps } from './auth.js';
import { setupRoutes, type SetupRouteDeps } from './setup.js';
import { providerPresetRoutes, type ProviderPresetRouteDeps } from './provider-presets.js';
import { providerAccountRoutes, type ProviderAccountRouteDeps } from './provider-accounts.js';
import { endpointRoutes, type EndpointRouteDeps } from './endpoints.js';
import { modelRoutes, type ModelRouteDeps } from './models.js';
import { channelRoutes, type ChannelRouteDeps } from './channels.js';
import { clientRoutes, type ClientRouteDeps } from './clients.js';
import { costRoutes, type CostRouteDeps } from './costs.js';
import { backupRoutes, type BackupRouteDeps } from './backups.js';
import { maintenanceRoutes, type MaintenanceRouteDeps } from './maintenance.js';
import { usageRoutes, type UsageRouteDeps } from './usage.js';
import { traceRoutes, type TraceRouteDeps } from './traces.js';
import { modelReferenceRoutes, type ModelReferenceRouteDeps } from './model-reference.js';
import { snippetRoutes, type SnippetRouteDeps } from './snippets.js';
import { settingsRoutes, type SettingsRouteDeps } from './settings.js';
import { resilienceRoutes, type ResilienceRouteDeps } from './resilience.js';
import { debugContentRoutes, type DebugContentRouteDeps } from './debug-content.js';

export interface AdminRoutesDeps {
  auth: AdminAuthRouteDeps;
  setup: SetupRouteDeps;
  providerPresets: ProviderPresetRouteDeps;
  providerAccounts: ProviderAccountRouteDeps;
  endpoints: EndpointRouteDeps;
  models: ModelRouteDeps;
  channels: ChannelRouteDeps;
  clients: ClientRouteDeps;
  costs: CostRouteDeps;
  backups: BackupRouteDeps;
  maintenance: MaintenanceRouteDeps;
  usage: UsageRouteDeps;
  traces: TraceRouteDeps;
  modelReference: ModelReferenceRouteDeps;
  snippets: SnippetRouteDeps;
  settings: SettingsRouteDeps;
  resilience: ResilienceRouteDeps;
  debugContent: DebugContentRouteDeps;
}

export async function adminRoutes(app: FastifyInstance, deps: AdminRoutesDeps): Promise<void> {
  await app.register(async (subApp) => subApp.register(adminAuthRoutes, deps.auth), {
    prefix: '/auth',
  });
  await app.register(async (subApp) => subApp.register(setupRoutes, deps.setup), {
    prefix: '/setup',
  });
  await app.register(
    async (subApp) => subApp.register(providerPresetRoutes, deps.providerPresets),
    {
      prefix: '/provider-presets',
    },
  );
  // v1 概念：Provider Account。
  await app.register(
    async (subApp) => subApp.register(providerAccountRoutes, deps.providerAccounts),
    {
      prefix: '/provider-accounts',
    },
  );
  // v1 概念：Endpoint。Phase 1 仅注册占位，Phase 2 才接 service。
  await app.register(async (subApp) => subApp.register(endpointRoutes, deps.endpoints), {
    prefix: '/endpoints',
  });
  // v1 概念：Model。
  await app.register(async (subApp) => subApp.register(modelRoutes, deps.models), {
    prefix: '/models',
  });
  // v1 概念：Channel。
  await app.register(async (subApp) => subApp.register(channelRoutes, deps.channels), {
    prefix: '/channels',
  });
  // v1 概念：Client。包含 App 与 Consumer Key 的合并语义。
  await app.register(async (subApp) => subApp.register(clientRoutes, deps.clients), {
    prefix: '/clients',
  });
  // Costs 合并 pricing + plans，不再作为独立 contract。
  await app.register(async (subApp) => subApp.register(costRoutes, deps.costs), {
    prefix: '/costs',
  });
  await app.register(async (subApp) => subApp.register(backupRoutes, deps.backups), {
    prefix: '/backups',
  });
  await app.register(async (subApp) => subApp.register(maintenanceRoutes, deps.maintenance), {
    prefix: '/maintenance',
  });
  await app.register(async (subApp) => subApp.register(usageRoutes, deps.usage), {
    prefix: '/usage',
  });
  await app.register(async (subApp) => subApp.register(traceRoutes, deps.traces), {
    prefix: '/traces',
  });
  await app.register(async (subApp) => subApp.register(modelReferenceRoutes, deps.modelReference), {
    prefix: '/model-reference',
  });
  await app.register(async (subApp) => subApp.register(snippetRoutes, deps.snippets), {
    prefix: '/snippets',
  });
  await app.register(async (subApp) => subApp.register(settingsRoutes, deps.settings), {
    prefix: '/settings',
  });
  await app.register(async (subApp) => subApp.register(resilienceRoutes, deps.resilience), {
    prefix: '/resilience',
  });
  await app.register(async (subApp) => subApp.register(debugContentRoutes, deps.debugContent), {
    prefix: '/debug-content',
  });
}
