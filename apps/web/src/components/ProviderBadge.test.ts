import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ProviderBadge from './ProviderBadge.vue';

describe('ProviderBadge', () => {
  it('renders provider name, icon, size class, and brand color', () => {
    const wrapper = mount(ProviderBadge, {
      props: {
        name: 'Anthropic',
        icon: 'A',
        color: '#d97706',
        size: 'small',
      },
    });

    expect(wrapper.text()).toContain('Anthropic');
    expect(wrapper.text()).toContain('A');
    expect(wrapper.classes()).toContain('provider-badge--small');
    expect(wrapper.attributes('style')).toContain('--provider-brand: #d97706');
  });

  it('omits the icon and brand style when optional props are absent', () => {
    const wrapper = mount(ProviderBadge, {
      props: { name: 'Manual provider' },
    });

    expect(wrapper.text()).toContain('Manual provider');
    expect(wrapper.find('.provider-badge__icon').exists()).toBe(false);
    expect(wrapper.attributes('style')).toBeUndefined();
  });
});
