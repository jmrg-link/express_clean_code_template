import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { CustomError } from '#domain/shared/errors';

/**
 * RBAC simple. Asume que un middleware previo (JwtMiddleware) ha puesto
 * `req.user.roles`. Si no, devuelve 401 (no 403): el problema es que no
 * está autenticado, no que no tenga permiso.
 *
 * Uso:
 *   router.get('/admin-only', jwtMw, checkRole('admin'), handler)
 *   router.post('/op', jwtMw, checkRole('admin', 'operator'), handler)
 */
export const checkRole = (...allowedRoles: string[]): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(CustomError.unauthorized());
    const hasRole = req.user.roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      return next(
        CustomError.forbidden(`Requires one of [${allowedRoles.join(', ')}]`),
      );
    }
    next();
  };
};
