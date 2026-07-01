import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import AdminLayout from '../layouts/AdminLayout.vue';
import { useAuthStore } from '../stores/auth.js';
import { getSetupStatus } from '../api/admin/setup.js';

const routes: RouteRecordRaw[] = [
  {
    path: '/setup',
    name: 'setup',
    component: () => import('../pages/SetupWizard.vue'),
    meta: { standalone: true },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../pages/Login.vue'),
    meta: { standalone: true },
  },
  {
    path: '/',
    component: AdminLayout,
    children: [
      {
        path: '',
        name: 'overview',
        component: () => import('../pages/Overview.vue'),
        meta: { titleKey: 'layout.menu.overview' },
      },
      {
        path: '/provider-accounts',
        name: 'provider-accounts',
        component: () => import('../pages/ProviderAccounts.vue'),
        meta: { titleKey: 'layout.menu.providerAccounts' },
      },
      {
        path: '/models',
        name: 'models',
        component: () => import('../pages/Models.vue'),
        meta: { titleKey: 'layout.menu.models' },
      },
      {
        path: '/clients',
        name: 'clients',
        component: () => import('../pages/Clients.vue'),
        meta: { titleKey: 'layout.menu.clients' },
      },
      {
        path: '/usage',
        name: 'usage',
        component: () => import('../pages/Usage.vue'),
        meta: { titleKey: 'layout.menu.usage' },
      },
      {
        path: '/traces',
        name: 'traces',
        component: () => import('../pages/Traces.vue'),
        meta: { titleKey: 'layout.menu.traces' },
      },
      {
        path: '/costs',
        name: 'costs',
        component: () => import('../pages/Costs.vue'),
        meta: { titleKey: 'layout.menu.costs' },
      },
      {
        path: '/backups',
        name: 'backups',
        component: () => import('../pages/Backups.vue'),
        meta: { titleKey: 'layout.menu.backups' },
      },
      {
        path: '/settings',
        name: 'settings',
        component: () => import('../pages/Settings.vue'),
        meta: { titleKey: 'layout.menu.settings' },
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  if (to.name === 'setup') {
    const status = await getSetupStatus();
    if (!status.needsSetup) {
      return { name: 'login' };
    }
    return true;
  }

  if (to.meta.standalone) {
    return true;
  }

  const status = await getSetupStatus();
  if (status.needsSetup) {
    return { name: 'setup' };
  }

  const auth = useAuthStore();
  if (!auth.ready) {
    await auth.fetchMe();
  }
  if (!auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  return true;
});
