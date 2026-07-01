import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { errorEnvelope, listEnvelope, successEnvelope } from './envelope.js';

describe('envelopes', () => {
  it('validates a success envelope', () => {
    const schema = successEnvelope(z.object({ id: z.string() }));
    const parsed = schema.parse({ data: { id: 'pm_123' } });
    expect(parsed.data.id).toBe('pm_123');
  });

  it('validates an error envelope', () => {
    const parsed = errorEnvelope.parse({
      error: { message: 'bad', type: 'ValidationError', code: 'validation_error' },
    });
    expect(parsed.error.code).toBe('validation_error');
  });

  it('validates a list envelope', () => {
    const schema = listEnvelope(z.object({ name: z.string() }));
    const parsed = schema.parse({ data: [{ name: 'a' }, { name: 'b' }], total: 2 });
    expect(parsed.data).toHaveLength(2);
    expect(parsed.total).toBe(2);
  });
});
