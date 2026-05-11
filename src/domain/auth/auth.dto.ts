import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const RegisterSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(72),
  firstName: z.string().min(2).max(50).trim(),
  lastName: z.string().min(1).max(50).trim(),
  phone: z.string().optional(),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;

export const RefreshSchema = z.object({
  refresh_token: z.string().min(1),
});
export type RefreshDto = z.infer<typeof RefreshSchema>;
