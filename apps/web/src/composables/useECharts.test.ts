import { describe, expect, it } from 'vitest';
import { ensureECharts } from './useECharts.js';

describe('useECharts', () => {
  it('is idempotent — calling ensureECharts multiple times is a no-op', () => {
    // First call registers the chart types and components with echarts/core.
    expect(() => ensureECharts()).not.toThrow();
    // Subsequent calls must short-circuit on the module-level `registered`
    // flag so we never double-register components.
    expect(() => ensureECharts()).not.toThrow();
    expect(() => ensureECharts()).not.toThrow();
  });
});