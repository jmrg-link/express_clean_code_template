import { z } from 'zod';

export const ListStorageQuerySchema = z.object({
  prefix: z.string().optional(),
  maxKeys: z.coerce.number().int().positive().max(1000).default(100),
  continuationToken: z.string().optional(),
});
export type ListStorageQueryDto = z.infer<typeof ListStorageQuerySchema>;

export const SignedUrlParamsSchema = z.object({
  key: z.string().min(1),
  expiresIn: z.coerce.number().int().positive().max(3600).default(900),
});
export type SignedUrlParamsDto = z.infer<typeof SignedUrlParamsSchema>;
