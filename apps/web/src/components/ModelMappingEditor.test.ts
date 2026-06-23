import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ModelMappingEditor, { type ModelMappingItem } from './ModelMappingEditor.vue';
import { i18n } from '../i18n/index.js';

function mountEditor(modelValue: ModelMappingItem[], disabled = false) {
  currentModelValue = modelValue;
  return mount(ModelMappingEditor, {
    global: { plugins: [i18n] },
    props: {
      modelValue,
      disabled,
      'onUpdate:modelValue': (value: ModelMappingItem[]) => {
        currentModelValue = value;
        void wrapper.setProps({ modelValue: value });
      },
    },
  });
}

let wrapper: ReturnType<typeof mount>;
let currentModelValue: ModelMappingItem[];

describe('ModelMappingEditor', () => {
  it('adds, edits, disables, and removes model mapping rows', async () => {
    wrapper = mountEditor([{ realName: 'claude-real', publicName: 'claude-public', enabled: true }]);

    await wrapper.findAll('button').find((button) => button.text() === 'Add model')!.trigger('click');
    expect(currentModelValue).toHaveLength(2);

    const inputs = wrapper.findAll('input');
    await inputs[2]!.setValue('deepseek-real');
    await inputs[3]!.setValue('deepseek-public');
    expect(currentModelValue[1]).toMatchObject({
      realName: 'deepseek-real',
      publicName: 'deepseek-public',
      enabled: true,
    });

    await wrapper.findComponent({ name: 'Switch' }).vm.$emit('update:value', false);
    expect(currentModelValue[0]).toMatchObject({ enabled: false });

    await wrapper.findAll('button').find((button) => button.text() === '✕')!.trigger('click');
    expect(currentModelValue).toEqual([
      { realName: 'deepseek-real', publicName: 'deepseek-public', enabled: true },
    ]);
  });

  it('hides mutation controls when disabled', () => {
    wrapper = mountEditor([{ realName: 'real', publicName: 'public', enabled: true }], true);

    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.findAll('input').every((input) => input.attributes('disabled') !== undefined)).toBe(
      true,
    );
  });
});
