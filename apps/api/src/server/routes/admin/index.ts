import type { FastifyInstance } from 'fastify';
import { adminAuthRoutes, type AdminAuthRouteDeps } from './auth.js';
import { setupRoutes, type SetupRouteDeps } from './setup.js';
import { providerPresetRoutes, type ProviderPresetRouteDeps } from './provider-presets.js';
import { upstreamKeyRoutes, type UpstreamKeyRouteDeps } from './upstream-keys.js';
import { publicModelRoutes, type PublicModelRouteDeps } from './public-models.js';
import { modelGroupRoutes, type ModelGroupRouteDeps } from './model-groups.js';
import { appRoutes, type AppRouteDeps } from './apps.js';
import { consumerKeyRoutes, type ConsumerKeyRouteDeps } from './consumer-keys.js';
import { backupRoutes, type BackupRouteDeps } from './backups.js';
import { maintenanceRoutes, type MaintenanceRouteDeps } from './maintenance.js';
import { usageRoutes, type UsageRouteDeps } from './usage.js';
import { traceRoutes, type TraceRouteDeps } from './traces.js';
import { pricingRoutes, type PricingRouteDeps } from './pricing.js';
import { planRoutes, type PlanRouteDeps } from './plans.js';
import { settingsRoutes, type SettingsRouteDeps } from './settings.js';

export interface AdminRoutesDeps {
  auth: AdminAuthRouteDeps;
  setup: SetupRouteDeps;
  providerPresets: ProviderPresetRouteDeps;
  upstreamKeys: UpstreamKeyRouteDeps;
  publicModels: PublicModelRouteDeps;
  modelGroups: ModelGroupRouteDeps;
  apps: AppRouteDeps;
  consumerKeys: ConsumerKeyRouteDeps;
  backups: BackupRouteDeps;
  maintenance: MaintenanceRouteDeps;
  usage: UsageRouteDeps;
  traces: TraceRouteDeps;
  pricing: PricingRouteDeps;
  plans: PlanRouteDeps;
  settings: SettingsRouteDeps;
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
  await app.register(async (subApp) => subApp.register(upstreamKeyRoutes, deps.upstreamKeys), {
    prefix: '/upstream-keys',
  });
  await app.register(async (subApp) => subApp.register(publicModelRoutes, deps.publicModels), {
    prefix: '/public-models',
  });
  await app.register(async (subApp) => subApp.register(modelGroupRoutes, deps.modelGroups), {
    prefix: '/model-groups',
  });
  await app.register(async (subApp) => subApp.register(appRoutes, deps.apps), {
    prefix: '/apps',
  });
  await app.register(async (subApp) => subApp.register(consumerKeyRoutes, deps.consumerKeys), {
    prefix: '/consumer-keys',
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
  await app.register(async (subApp) => subApp.register(pricingRoutes, deps.pricing), {
    prefix: '/pricing',
  });
  await app.register(async (subApp) => subApp.register(planRoutes, deps.plans), {
    prefix: '/plans',
  });
  await app.register(async (subApp) => subApp.register(settingsRoutes, deps.settings), {
    prefix: '/settings',
  });
}
