import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import AdminLayout from '../layouts/AdminLayout.vue';
import { useAuthStore } from '../stores/auth.js';

const routes: RouteRecordRaw[] = [
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
        path: '/upstream-keys',
        name: 'upstream-keys',
        component: () => import('../pages/UpstreamKeys.vue'),
        meta: { titleKey: 'layout.menu.upstreamKeys' },
      },
      {
        path: '/provider-presets',
        name: 'provider-presets',
        component: () => import('../pages/ProviderPresets.vue'),
        meta: { titleKey: 'layout.menu.providerPresets' },
      },
      {
        path: '/public-models',
        name: 'public-models',
        component: () => import('../pages/PublicModels.vue'),
        meta: { titleKey: 'layout.menu.publicModels' },
      },
      {
        path: '/model-groups',
        name: 'model-groups',
        component: () => import('../pages/ModelGroups.vue'),
        meta: { titleKey: 'layout.menu.modelGroups' },
      },
      {
        path: '/apps',
        name: 'apps',
        component: () => import('../pages/Apps.vue'),
        meta: { titleKey: 'layout.menu.apps' },
      },
      {
        path: '/backups',
        name: 'backups',
        component: () => import('../pages/Backups.vue'),
        meta: { titleKey: 'layout.menu.backups' },
      },
      {
        path: '/usage',
        name: 'usage',
        component: () => import('../pages/Usage.vue'),
        meta: { titleKey: 'layout.menu.usage' },
      },
      {
        path: '/settings',
        name: 'settings',
        component: () => import('../pages/Settings.vue'),
        meta: { titleKey: 'layout.menu.settings' },
      },
      {
        path: '/setup',
        name: 'setup',
        component: () => import('../pages/SetupWizard.vue'),
        meta: { titleKey: 'layout.menu.setup' },
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  if (to.meta.standalone) {
    return true;
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
