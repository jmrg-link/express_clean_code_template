import type { Request, Response, NextFunction } from 'express';
import type { UserFacade } from '#application/user/user.facade';
import type { ListUserDto } from '#domain/user/user.dto';
import { ResponseFormatter } from '#domain/shared/response/response.formatter';

/**
 * Capa HTTP. Solo:
 *   - extrae datos de Request (body / params / validatedQuery)
 *   - delega a UserFacade (que orquesta los use-cases)
 *   - formatea la respuesta con `ResponseFormatter.success`
 *   - propaga errores con `next(err)` para que el Chain los maneje
 *
 * Sin lógica de negocio. Sin condicionales sobre roles. Eso vive en use-cases
 * o en middlewares (checkRole).
 */
export class UserController {
  public constructor(private readonly facade: UserFacade) {}

  public list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = (req.validatedQuery ?? req.query) as ListUserDto;
      const result = await this.facade.list(dto);
      res
        .status(200)
        .json(
          ResponseFormatter.success('Users retrieved successfully', result.data, result.pagination),
        );
    } catch (err) {
      next(err);
    }
  };

  public show = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.facade.findById(String(req.params.id));
      res.status(200).json(ResponseFormatter.success('User retrieved successfully', user));
    } catch (err) {
      next(err);
    }
  };

  public create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.facade.create(req.body);
      res.status(201).json(ResponseFormatter.success('User created successfully', user));
    } catch (err) {
      next(err);
    }
  };

  public update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.facade.update(String(req.params.id), req.body);
      res.status(200).json(ResponseFormatter.success('User updated successfully', user));
    } catch (err) {
      next(err);
    }
  };

  public remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.facade.softDelete(String(req.params.id));
      res.status(200).json(ResponseFormatter.success('User deactivated successfully', user));
    } catch (err) {
      next(err);
    }
  };
}
