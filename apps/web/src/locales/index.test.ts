import { describe, expect, it } from 'vitest';
import { messages, supportedLocales } from './index.js';

function readPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, root);
}

describe('locale dynamic keys', () => {
  it('contains labels for dynamic layout and settings keys in every supported locale', () => {
    const dynamicKeys = [
      'layout.menu.login',
      'modelReference.columns.intelligence',
      'modelReference.columns.chat',
      'modelReference.columns.knowledge',
      'modelReference.columns.math',
      'modelReference.columns.chinese',
      'modelReference.columns.reasoning',
      'modelReference.columns.coding',
      'modelReference.columns.agentic',
      'modelReference.columns.costEfficiency',
      'modelReference.columns.price',
      'modelReference.columns.context',
    ];

    for (const locale of supportedLocales) {
      for (const key of dynamicKeys) {
        expect(readPath(messages[locale], key), `${locale}:${key}`).toEqual(expect.any(String));
        expect(readPath(messages[locale], key), `${locale}:${key}`).not.toBe('');
      }
    }
  });
});
