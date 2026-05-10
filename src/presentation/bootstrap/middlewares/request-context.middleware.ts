import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import type { LoggerPort } from '#domain/shared/logger/logger.port';
import { RequestContextLoggerDecorator } from '#infrastructure/logger/request-context.decorator';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      logger?: LoggerPort;
    }
  }
}

/**
 * Middleware que:
 *   1. Genera (o reutiliza desde header `X-Request-Id`) un id único.
 *   2. Lo expone en `req.requestId` y en el header de respuesta.
 *   3. Crea un logger con contexto (requestId, route, method) y lo cuelga
 *      de `req.logger`.
 *
 * Uso desde controllers/use-cases:
 *   `req.logger?.info('user created', { userId })`
 *
 * El decorator hace que cada línea lleve los campos sin escribirlos a mano.
 */
export class RequestContextMiddleware {
  public constructor(private readonly baseLogger: LoggerPort) {}

  public handle(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const requestId = req.header('X-Request-Id') ?? randomUUID();
      req.requestId = requestId;
      res.setHeader('X-Request-Id', requestId);
      req.logger = new RequestContextLoggerDecorator(this.baseLogger, {
        requestId,
        method: req.method,
        route: req.path,
      });
      next();
    };
  }
}
