import { z } from 'zod';
import { USER_ROLES, USER_PROVIDERS } from './user.entity.js';
import { Slugger } from '#domain/shared/slug/slugger';

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

export const UserIdSchema = z.object({
  id: z.string().regex(objectIdRegex, 'Invalid ObjectId'),
});
export type UserIdDto = z.infer<typeof UserIdSchema>;

/**
 * CreateUser DTO.
 *
 * `slug` se genera con Zod transform — si el cliente no lo manda, lo derivamos
 * de `${firstName} ${lastName}`. Si lo manda, lo normalizamos con Slugger igual
 * (defensa). Esto sigue la pauta del usuario:
 *   "slugify para urls limpias con schema y zod"
 */
export const CreateUserSchema = z
  .object({
    keycloak_id: z.string().min(1),
    email: z.string().email().toLowerCase().trim(),
    firstName: z.string().min(2).max(50).trim(),
    lastName: z.string().min(1).max(50).trim(),
    slug: z.string().optional(),
    phone: z.string().optional(),
    picture: z.string().url().optional(),
    avatar_url: z.string().optional(),
    provider: z.enum(USER_PROVIDERS).default('password'),
    roles: z.array(z.enum(USER_ROLES)).default(['buyer']),
  })
  .transform((data) => ({
    ...data,
    slug: data.slug
      ? Slugger.base(data.slug)
      : Slugger.withRandomSuffix(`${data.firstName} ${data.lastName}`),
  }));
export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    firstName: z.string().min(2).max(50).trim().optional(),
    lastName: z.string().min(1).max(50).trim().optional(),
    slug: z
      .string()
      .optional()
      .transform((v) => (v ? Slugger.base(v) : v)),
    phone: z.string().optional(),
    picture: z.string().url().optional(),
    avatar_url: z.string().optional(),
    roles: z.array(z.enum(USER_ROLES)).optional(),
    email_verified: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided for update',
  });
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

export const ListUserSchema = z.object({
  email: z.string().optional(),
  firstName: z.string().optional(),
  slug: z.string().optional(),
  is_active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  roles: z.enum(USER_ROLES).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ListUserDto = z.infer<typeof ListUserSchema>;
