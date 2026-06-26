import { api } from '../client.js';
import type {
  PlanContract,
  PlanReminderContract,
  CreatePlanRequest,
  UpdatePlanRequest,
} from '@manageyourllm/contracts';

export async function listPlans(): Promise<PlanContract[]> {
  const res = await api.get<{ data: PlanContract[] }>('/api/admin/plans');
  return res.data;
}

export async function getPlanReminders(): Promise<PlanReminderContract[]> {
  const res = await api.get<{ data: PlanReminderContract[] }>('/api/admin/plans/reminders');
  return res.data;
}

export async function createPlan(body: CreatePlanRequest): Promise<PlanContract> {
  const res = await api.post<{ data: PlanContract }>('/api/admin/plans', body);
  return res.data;
}

export async function updatePlan(id: string, body: UpdatePlanRequest): Promise<PlanContract> {
  const res = await api.put<{ data: PlanContract }>(`/api/admin/plans/${id}`, body);
  return res.data;
}

export async function deletePlan(id: string): Promise<void> {
  await api.delete(`/api/admin/plans/${id}`);
}
