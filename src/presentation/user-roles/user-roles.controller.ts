import type { Request, Response, NextFunction } from 'express';
import type { UserRolesFacade } from '#application/user-roles/user-roles.facade';
import type { UserRole } from '#domain/user/user.entity';
import { CustomError } from '#domain/shared/errors';
import { ResponseFormatter } from '#domain/shared/response/response.formatter';

/**
 * Capa HTTP del CRUD de roles.
 *
 * @remarks
 * Lee `req.user.id` (sub KC del admin que solicita) para el guard de
 * self-demotion y para el `actorId` del evento. Sin lógica de negocio.
 */
export class UserRolesController {
  public constructor(private readonly facade: UserRolesFacade) {}

  public list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { roles } = await this.facade.get(String(req.params.id));
      res.status(200).json(ResponseFormatter.success('Roles retrieved', { roles }));
    } catch (err) {
      next(err);
    }
  };

  public replace = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actorId = this.requireActorId(req);
      const { roles } = await this.facade.replace(
        String(req.params.id),
        req.body.roles as UserRole[],
        actorId,
      );
      res.status(200).json(ResponseFormatter.success('Roles replaced', { roles }));
    } catch (err) {
      next(err);
    }
  };

  public add = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actorId = this.requireActorId(req);
      await this.facade.add(String(req.params.id), req.params.role as UserRole, actorId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  public remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actorId = this.requireActorId(req);
      await this.facade.remove(String(req.params.id), req.params.role as UserRole, actorId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  /**
   * Extrae el `req.user.id` añadido por `JwtMiddleware`. Si falta, el flujo
   * llegó aquí sin pasar por `jwt` — fail-fast como 401.
   */
  private requireActorId(req: Request): string {
    if (!req.user?.id) throw CustomError.unauthorized();
    return req.user.id;
  }
}
