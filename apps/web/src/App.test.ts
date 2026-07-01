import { describe, it, expect } from 'vitest';
import { NConfigProvider } from 'naive-ui';
import { mountWithProviders } from './test-utils.js';
import App from './App.vue';

describe('App', () => {
  it('mounts the app shell', () => {
    const wrapper = mountWithProviders(App);
    expect(wrapper.findComponent(NConfigProvider).exists()).toBe(true);
  });
});
