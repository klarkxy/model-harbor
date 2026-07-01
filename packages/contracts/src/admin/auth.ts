import { z } from 'zod';
import { successEnvelope, errorEnvelope } from '../envelope.js';

export const loginRequestSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

export const adminSummarySchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
});

export const loginResponseSchema = successEnvelope(
  z.object({
    admin: adminSummarySchema,
  }),
);

export const meResponseSchema = successEnvelope(
  z.object({
    admin: adminSummarySchema,
  }),
);

export const logoutResponseSchema = successEnvelope(z.object({ ok: z.boolean() }));

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, '当前密码不能为空'),
  newPassword: z.string().min(8, '新密码至少 8 位'),
});

export const changePasswordResponseSchema = successEnvelope(
  z.object({ admin: adminSummarySchema }),
);

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type ChangePasswordResponse = z.infer<typeof changePasswordResponseSchema>;

export { errorEnvelope };
