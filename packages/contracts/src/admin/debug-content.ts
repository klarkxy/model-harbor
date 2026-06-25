import { z } from 'zod';
import { successEnvelope, listEnvelope } from '../envelope.js';

export const debugContentLogSchema = z.object({
  id: z.string(),
  requestTraceId: z.string().nullable(),
  promptJson: z.unknown().nullable(),
  responseJson: z.unknown().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  createdAt: z.string().datetime(),
});

export const listDebugContentLogsResponseSchema = listEnvelope(debugContentLogSchema);
export const debugContentLogResponseSchema = successEnvelope(debugContentLogSchema);

export type DebugContentLogContract = z.infer<typeof debugContentLogSchema>;
