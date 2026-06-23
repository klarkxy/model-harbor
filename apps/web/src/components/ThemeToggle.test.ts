import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ThemeToggle from './ThemeToggle.vue';
import { i18n } from '../i18n/index.js';
import { useThemeStore } from '../theme/index.js';

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    setActivePinia(createPinia());
  });

  it('toggles theme mode, persists it, and updates the document theme marker', async () => {
    const eventSpy = vi.fn();
    window.addEventListener('themechange', eventSpy);
    const theme = useThemeStore();
    theme.setMode('light');

    const wrapper = mount(ThemeToggle, {
      global: {
        plugins: [i18n],
        stubs: {
          NTooltip: { template: '<div><slot name="trigger" /><slot /></div>' },
          NButton: { template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot name="icon" /></button>' },
          NIcon: { template: '<span><slot /></span>' },
        },
      },
    });

    expect(wrapper.find('button').attributes('aria-label')).toBe('Toggle theme');
    await wrapper.find('button').trigger('click');

    expect(theme.mode).toBe('dark');
    expect(localStorage.getItem('modelharbor-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(eventSpy).toHaveBeenCalled();
    window.removeEventListener('themechange', eventSpy);
  });
});
