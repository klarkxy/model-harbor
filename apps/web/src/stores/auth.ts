import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '../api/client.js';

export interface AdminSummary {
  id: string;
  username: string;
  displayName: string;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AdminSummary | null>(null);
  const ready = ref(false);
  const isAuthenticated = computed(() => user.value !== null);

  async function login(username: string, password: string): Promise<void> {
    await api.post('/api/admin/auth/login', { username, password });
    await fetchMe();
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/api/admin/auth/logout');
    } finally {
      user.value = null;
      ready.value = true;
    }
  }

  async function fetchMe(): Promise<void> {
    try {
      const me = await api.get<{ data: AdminSummary }>('/api/admin/auth/me');
      user.value = me.data;
    } catch {
      user.value = null;
    } finally {
      ready.value = true;
    }
  }

  return { user, ready, isAuthenticated, login, logout, fetchMe };
});
