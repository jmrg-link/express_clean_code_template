import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ZodSchema } from 'zod';

/**
 * Factory de middlewares de validación Zod.
 *
 * NOTA: NO atrapamos el ZodError aquí; lo dejamos propagar al
 * ErrorHandler chain para que el `ZodErrorHandler` lo formatee
 * con field-errors. Así la presentación de errores está centralizada.
 */
export const validate = {
  body<T>(schema: ZodSchema<T>): RequestHandler {
    return (req: Request, _res: Response, next: NextFunction) => {
      req.body = schema.parse(req.body);
      next();
    };
  },

  query<T>(schema: ZodSchema<T>): RequestHandler {
    return (req: Request, _res: Response, next: NextFunction) => {
      const parsed = schema.parse(req.query);
      (req as Request & { validatedQuery?: unknown }).validatedQuery = parsed;
      next();
    };
  },

  /**
   * Valida `req.params` contra un schema Zod. Las claves del schema deben
   * coincidir con los nombres de los parámetros del path (ej. `:role`).
   * Si pasa, escribe los valores parseados de vuelta sobre `req.params`.
   */
  params<T extends Record<string, string>>(schema: ZodSchema<T>): RequestHandler {
    return (req: Request, _res: Response, next: NextFunction) => {
      const parsed = schema.parse(req.params);
      Object.assign(req.params, parsed);
      next();
    };
  },
};

declare global {
  namespace Express {
    interface Request {
      validatedQuery?: unknown;
    }
  }
}
