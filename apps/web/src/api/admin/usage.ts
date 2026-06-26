import { api } from '../client.js';
import type {
  UsageDashboardContract,
  DailyConsumptionStatContract,
} from '@manageyourllm/contracts';

export async function getUsageDashboard(since?: string): Promise<UsageDashboardContract> {
  const url = since
    ? `/api/admin/usage/dashboard?since=${encodeURIComponent(since)}`
    : '/api/admin/usage/dashboard';
  const res = await api.get<{ data: UsageDashboardContract }>(url);
  return res.data;
}

export async function getDailyConsumptionStats(
  date?: string,
): Promise<DailyConsumptionStatContract[]> {
  const url = date
    ? `/api/admin/usage/daily?date=${encodeURIComponent(date)}`
    : '/api/admin/usage/daily';
  const res = await api.get<{ data: DailyConsumptionStatContract[] }>(url);
  return res.data;
}
