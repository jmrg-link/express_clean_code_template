import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { IamPort } from '#domain/auth/iam.port';
import type { AuthenticatedUser } from '#domain/auth/auth.entity';
import { CustomError } from '#domain/shared/errors';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Middleware JWT genérico. Acepta cualquier `IamPort`, así puedes inyectar
 * un mock en tests sin tocar Keycloak real.
 *
 * Política DRY: se construye una sola vez en main.ts y se reutiliza en todos
 * los routers (User, Auth.me, futuros). Esto resuelve el punto crítico del
 * review anterior: JWT NO es de la feature Auth, es transversal.
 */
export class JwtMiddleware {
  public constructor(private readonly iam: IamPort) {}

  public handle(): RequestHandler {
    return async (req: Request, _res: Response, next: NextFunction) => {
      try {
        const auth = req.header('Authorization');
        if (!auth?.startsWith('Bearer ')) {
          return next(CustomError.unauthorized('Authorization token required'));
        }
        const token = auth.slice(7);
        const user = await this.iam.verifyToken(token);
        req.user = user;
        next();
      } catch (err) {
        next(err);
      }
    };
  }
}
