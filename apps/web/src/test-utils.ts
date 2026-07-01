import type { Component } from 'vue';
import { mount, type MountingOptions } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { i18n } from './i18n/index.js';

export function mountWithProviders(component: Component, options: MountingOptions<unknown> = {}) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/', component: { template: '<div>home</div>' } }],
  });
  return mount(component, {
    ...options,
    global: {
      ...options.global,
      plugins: [...(options.global?.plugins ?? []), i18n, router],
    },
  });
}
