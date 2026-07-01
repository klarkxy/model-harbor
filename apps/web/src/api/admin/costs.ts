import { api } from '../client.js';
import type {
  PricingEntryContract,
  CreatePricingEntryRequest,
  UpdatePricingEntryRequest,
  PlanContract,
  PlanReminderContract,
  CreatePlanRequest,
  UpdatePlanRequest,
} from '@manageyourllm/contracts';

// Phase 1 Slice 2 + Phase 10 Slice A 合并：Costs API client。
// 聚合定价 (`/costs/pricing`) + 套餐账本 (`/costs/plans`)，路径为 v1 形态。

export type PricingEntry = PricingEntryContract;
export type Plan = PlanContract;
export type PlanReminder = PlanReminderContract;
export type {
  CreatePricingEntryRequest,
  UpdatePricingEntryRequest,
  CreatePlanRequest,
  UpdatePlanRequest,
};

// ---- 模型定价 (`/costs/pricing`) ----

export async function listPricingEntries(): Promise<PricingEntry[]> {
  const res = await api.get<{ data: PricingEntry[] }>('/api/admin/costs/pricing');
  return res.data;
}

export async function createPricingEntry(body: CreatePricingEntryRequest): Promise<PricingEntry> {
  const res = await api.post<{ data: PricingEntry }>('/api/admin/costs/pricing', body);
  return res.data;
}

export async function updatePricingEntry(
  id: string,
  body: UpdatePricingEntryRequest,
): Promise<PricingEntry> {
  const res = await api.put<{ data: PricingEntry }>(`/api/admin/costs/pricing/${id}`, body);
  return res.data;
}

export async function deletePricingEntry(id: string): Promise<void> {
  await api.delete(`/api/admin/costs/pricing/${id}`);
}

// ---- 套餐账本 (`/costs/plans`) ----

export async function listPlans(): Promise<Plan[]> {
  const res = await api.get<{ data: Plan[] }>('/api/admin/costs/plans');
  return res.data;
}

export async function getPlanReminders(): Promise<PlanReminder[]> {
  const res = await api.get<{ data: PlanReminder[] }>('/api/admin/costs/plans/reminders');
  return res.data;
}

export async function createPlan(body: CreatePlanRequest): Promise<Plan> {
  const res = await api.post<{ data: Plan }>('/api/admin/costs/plans', body);
  return res.data;
}

export async function updatePlan(id: string, body: UpdatePlanRequest): Promise<Plan> {
  const res = await api.put<{ data: Plan }>(`/api/admin/costs/plans/${id}`, body);
  return res.data;
}

export async function deletePlan(id: string): Promise<void> {
  await api.delete(`/api/admin/costs/plans/${id}`);
}
