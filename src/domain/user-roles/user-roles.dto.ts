import { z } from 'zod';
import { USER_ROLES } from '#domain/user/user.entity';

/**
 * Body para `PUT /users/:id/roles` — reemplazo idempotente del set completo.
 * Requiere al menos un rol; el server no acepta dejar al usuario sin roles
 * (estado degenerado que rompería filtros y middlewares aguas abajo).
 */
export const ReplaceRolesSchema = z.object({
  roles: z.array(z.enum(USER_ROLES)).min(1, 'at least one role is required'),
});
export type ReplaceRolesDto = z.infer<typeof ReplaceRolesSchema>;

/**
 * Path param para `POST|DELETE /users/:id/roles/:role`. Restringido al
 * catálogo cerrado del realm para evitar inyección en la ruta del KC adapter.
 */
export const RoleParamSchema = z.object({
  role: z.enum(USER_ROLES),
});
export type RoleParamDto = z.infer<typeof RoleParamSchema>;
