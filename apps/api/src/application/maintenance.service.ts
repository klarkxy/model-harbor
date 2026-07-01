import { AdminUserRepository } from '../infrastructure/db/repositories/admin-user.repository.js';
import { ObservabilityRepository } from '../infrastructure/db/repositories/observability.repository.js';
import { RoutingStateRepository } from '../infrastructure/db/repositories/routing-state.repository.js';
import { ProviderAccountRepository } from '../infrastructure/db/repositories/provider-account.repository.js';
import { SettingsService } from './settings.service.js';
import type { Db } from '../infrastructure/db/client.js';

export interface MaintenanceServiceDeps {
  db: Db;
}

export interface MaintenanceRunResult {
  cleanedAt: Date;
}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000;

export class MaintenanceService {
  private readonly routingStateRepo: RoutingStateRepository;
  private readonly providerAccountRepo: ProviderAccountRepository;
  private readonly observabilityRepo: ObservabilityRepository;
  private readonly adminUserRepo: AdminUserRepository;
  private readonly settingsService: SettingsService;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly deps: MaintenanceServiceDeps) {
    this.routingStateRepo = new RoutingStateRepository(deps.db);
    this.providerAccountRepo = new ProviderAccountRepository(deps.db);
    this.observabilityRepo = new ObservabilityRepository(deps.db);
    this.adminUserRepo = new AdminUserRepository(deps.db);
    this.settingsService = new SettingsService(deps.db);
  }

  start(intervalMs = DEFAULT_INTERVAL_MS): void {
    this.stop();
    this.timer = setInterval(() => {
      this.run().catch(() => {});
    }, intervalMs);
    // 启动后先延迟执行一次，避免刚启动就抢资源。
    setTimeout(() => {
      this.run().catch(() => {});
    }, STARTUP_DELAY_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(now = new Date()): Promise<MaintenanceRunResult> {
    if (this.running) {
      return { cleanedAt: now };
    }
    this.running = true;

    try {
      const settings = await this.settingsService.getSettings();

      await this.routingStateRepo.deleteExpiredStickyBindings(now);
      await this.routingStateRepo.deleteExpiredStickySessions(now);
      await this.providerAccountRepo.deleteExpiredCounters(now);
      await this.routingStateRepo.deleteStaleBreakers(now);

      const contentLogRetentionDays = settings.contentLogRetentionDays;
      if (contentLogRetentionDays > 0) {
        const contentLogCutoff = new Date(
          now.getTime() - contentLogRetentionDays * 24 * 60 * 60 * 1000,
        );
        await this.observabilityRepo.deleteOldDebugContentLogs(contentLogCutoff);
      }

      const traceCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      await this.observabilityRepo.deleteOldTraceLogs(traceCutoff);

      const auditCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      await this.observabilityRepo.deleteOldAuditEvents(auditCutoff);

      const dailyStatsCutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      await this.observabilityRepo.deleteOldDailyStats(dailyStatsCutoff);

      await this.adminUserRepo.deleteExpiredSessions(now);

      return { cleanedAt: now };
    } finally {
      this.running = false;
    }
  }
}
