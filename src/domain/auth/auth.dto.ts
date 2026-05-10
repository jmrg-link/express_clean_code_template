import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const RegisterSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(72),
  name: z.string().min(2).max(100),
  phone: z.string().optional(),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;

export const RefreshSchema = z.object({
  refresh_token: z.string().min(1),
});
export type RefreshDto = z.infer<typeof RefreshSchema>;
