import { z } from 'zod';
import { listEnvelope, successEnvelope } from '../envelope.js';

export const traceSummarySchema = z.object({
  requestTraceId: z.string(),
  appId: z.string(),
  consumerKeyId: z.string(),
  requestedTargetName: z.string(),
  upstreamKeyId: z.string(),
  realModelName: z.string(),
  resolvedTargetType: z.enum(['public_model', 'model_group']).nullable(),
  resolvedTargetId: z.string().nullable(),
  status: z.string(),
  latencyMs: z.number(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  attemptCount: z.number(),
  createdAt: z.string().datetime(),
});

export const traceEventSchema = z.object({
  id: z.string(),
  step: z.string(),
  stepIndex: z.number(),
  status: z.string().nullish(),
  upstreamKeyId: z.string().nullish(),
  realModelName: z.string().nullish(),
  errorCode: z.string().nullish(),
  errorMessage: z.string().nullish(),
  details: z.record(z.unknown()).nullish(),
  createdAt: z.string().datetime(),
});

export const traceDetailSchema = z.object({
  summary: traceSummarySchema.nullable(),
  events: z.array(traceEventSchema),
});

export const listTracesResponseSchema = listEnvelope(traceSummarySchema);
export const traceDetailResponseSchema = successEnvelope(traceDetailSchema);

export type TraceSummaryContract = z.infer<typeof traceSummarySchema>;
export type TraceEventContract = z.infer<typeof traceEventSchema>;
export type TraceDetailContract = z.infer<typeof traceDetailSchema>;
