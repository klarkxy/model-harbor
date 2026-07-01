import { describe, it, expect } from 'vitest';
import {
  requestRequiresCapability,
  requestRequiresAdvancedCrossProtocol,
  requiredCapabilities,
} from './capabilities.js';

describe('requiredCapabilities', () => {
  it('detects streaming', () => {
    expect(requiredCapabilities({ stream: true }).streaming).toBe(true);
    expect(requiredCapabilities({ stream: false }).streaming).toBeUndefined();
  });

  it('detects tools and toolChoice', () => {
    expect(requiredCapabilities({ tools: [{ name: 'x' }] }).tools).toBe(true);
    expect(requiredCapabilities({ tool_choice: 'auto' }).toolChoice).toBe(true);
    expect(requiredCapabilities({ tool_choice: 'none' }).toolChoice).toBeUndefined();
  });

  it('detects jsonMode', () => {
    expect(requiredCapabilities({ response_format: { type: 'json_object' } }).jsonMode).toBe(true);
    expect(requiredCapabilities({ json_mode: true }).jsonMode).toBe(true);
  });

  it('detects thinking / reasoning', () => {
    expect(requiredCapabilities({ thinking: { type: 'enabled' } }).thinking).toBe(true);
    expect(requiredCapabilities({ reasoning: {} }).thinking).toBe(true);
  });

  it('detects vision in messages', () => {
    const req = {
      messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }],
    };
    expect(requiredCapabilities(req).vision).toBe(true);
  });

  it('detects vision in responses input items', () => {
    const req = {
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_image' }] }],
    };
    expect(requiredCapabilities(req).vision).toBe(true);
  });

  it('returns empty object for non-object input', () => {
    expect(requiredCapabilities(null)).toEqual({});
    expect(requiredCapabilities('foo')).toEqual({});
  });
});

describe('requestRequiresCapability', () => {
  it('checks a single capability', () => {
    expect(requestRequiresCapability({ stream: true }, 'streaming')).toBe(true);
    expect(requestRequiresCapability({}, 'streaming')).toBe(false);
  });
});

describe('requestRequiresAdvancedCrossProtocol', () => {
  it('returns false for plain text requests', () => {
    expect(requestRequiresAdvancedCrossProtocol({ model: 'x', messages: [] })).toBe(false);
    expect(requestRequiresAdvancedCrossProtocol({ stream: true, messages: [] })).toBe(false);
  });

  it('returns true for tools, json mode, thinking and vision', () => {
    expect(requestRequiresAdvancedCrossProtocol({ tools: [{ name: 'x' }] })).toBe(true);
    expect(requestRequiresAdvancedCrossProtocol({ tool_choice: 'auto' })).toBe(true);
    expect(requestRequiresAdvancedCrossProtocol({ response_format: { type: 'json_object' } })).toBe(
      true,
    );
    expect(requestRequiresAdvancedCrossProtocol({ thinking: { type: 'enabled' } })).toBe(true);
    expect(
      requestRequiresAdvancedCrossProtocol({
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
      }),
    ).toBe(true);
  });
});
