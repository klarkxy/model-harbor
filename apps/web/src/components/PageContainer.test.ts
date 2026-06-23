import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PageContainer from './PageContainer.vue';

describe('PageContainer', () => {
  it('renders the title prop inside the header when provided', () => {
    const wrapper = mount(PageContainer, {
      props: { title: 'My Page' },
      slots: { default: '<p>page body</p>' },
    });
    expect(wrapper.text()).toContain('My Page');
    expect(wrapper.text()).toContain('page body');
  });

  it('exposes a max-width via the --page-max CSS variable', () => {
    const wrapper = mount(PageContainer, {
      props: { maxWidth: 1400 },
      slots: { default: 'body' },
    });
    expect(wrapper.attributes('style')).toContain('--page-max: 1400px');
  });

  it('falls back to 1200px when maxWidth is not provided', () => {
    const wrapper = mount(PageContainer, {
      slots: { default: 'body' },
    });
    expect(wrapper.attributes('style')).toContain('--page-max: 1200px');
  });

  it('renders the actions slot on the right of the header', () => {
    const wrapper = mount(PageContainer, {
      props: { title: 'T' },
      slots: {
        default: 'body',
        actions: '<button data-testid="custom-action">Go</button>',
      },
    });
    const html = wrapper.html();
    expect(html).toContain('custom-action');
    expect(html).toContain('Go');
    // The actions slot is wrapped in `.page-container__actions`.
    expect(html).toMatch(/page-container__actions/);
  });

  it('omits the header entirely when neither title nor header slot is provided', () => {
    const wrapper = mount(PageContainer, {
      slots: { default: 'body-only' },
    });
    expect(wrapper.text()).toContain('body-only');
    // Without a title or header slot, the head wrapper should not render.
    expect(wrapper.html()).not.toMatch(/page-container__head/);
  });

  it('prefers the header slot over the title prop when both are provided', () => {
    const wrapper = mount(PageContainer, {
      props: { title: 'Prop Title' },
      slots: {
        default: 'body',
        header: '<span data-testid="custom-header">Custom Header</span>',
      },
    });
    const html = wrapper.html();
    expect(html).toContain('Custom Header');
    expect(html).not.toContain('Prop Title');
  });
});