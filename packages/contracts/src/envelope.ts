import { z } from 'zod';

// 通用 API 响应包络。成功包络在 data 中承载任意 schema；
// 错误包络统一使用 { error: { message, type, code } } 形状。

export function successEnvelope<T extends z.ZodTypeAny>(schema: T) {
  return z.object({
    data: schema,
  });
}

export const errorEnvelope = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export function listEnvelope<T extends z.ZodTypeAny>(schema: T) {
  return z.object({
    data: z.array(schema),
    total: z.number().int().nonnegative().optional(),
  });
}

export type SuccessEnvelope<T> = { data: T };
export type ErrorEnvelope = z.infer<typeof errorEnvelope>;
export type ListEnvelope<T> = { data: T[]; total?: number };
