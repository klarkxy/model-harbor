import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import KeyValueEditor, { type KeyValueItem } from './KeyValueEditor.vue';
import { i18n } from '../i18n/index.js';

function mountEditor(modelValue: KeyValueItem[], disabled = false) {
  currentModelValue = modelValue;
  return mount(KeyValueEditor, {
    global: { plugins: [i18n] },
    props: {
      modelValue,
      disabled,
      'onUpdate:modelValue': (value: KeyValueItem[]) => {
        currentModelValue = value;
        void wrapper.setProps({ modelValue: value });
      },
    },
  });
}

let wrapper: ReturnType<typeof mount>;
let currentModelValue: KeyValueItem[];

describe('KeyValueEditor', () => {
  it('adds, edits, toggles, and removes rows through model updates', async () => {
    const initial: KeyValueItem[] = [{ key: 'x-api-key', value: 'secret', enabled: true }];
    wrapper = mountEditor(initial);

    await wrapper.findAll('button').find((button) => button.text() === 'Add')!.trigger('click');
    expect(currentModelValue).toHaveLength(2);

    const inputs = wrapper.findAll('input');
    await inputs[2]!.setValue('x-extra');
    await inputs[3]!.setValue('42');
    expect(currentModelValue[1]).toMatchObject({ key: 'x-extra', value: '42' });

    await wrapper.findComponent({ name: 'Switch' }).vm.$emit('update:value', false);
    expect(currentModelValue[0]).toMatchObject({ enabled: false });

    await wrapper.findAll('button').find((button) => button.text() === '✕')!.trigger('click');
    expect(currentModelValue).toEqual([{ key: 'x-extra', value: '42', enabled: true }]);
  });

  it('hides mutating controls when disabled', () => {
    wrapper = mountEditor([{ key: 'Authorization', value: 'Bearer token', enabled: true }], true);

    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.findAll('input').every((input) => input.attributes('disabled') !== undefined)).toBe(
      true,
    );
  });
});
