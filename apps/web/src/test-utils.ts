import type { Component } from 'vue';
import { mount, type MountingOptions } from '@vue/test-utils';
import { i18n } from './i18n/index.js';

export function mountWithI18n(component: Component, options: MountingOptions<unknown> = {}) {
  return mount(component, {
    ...options,
    global: {
      ...options.global,
      plugins: [...(options.global?.plugins ?? []), i18n],
    },
  });
}
