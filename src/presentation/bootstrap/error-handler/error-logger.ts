import colors from 'colors';
import type { Request } from 'express';
import type { LoggerPort } from '#domain/shared/logger/logger.port';
import { ClientError, ServerError } from '#domain/shared/errors';

/**
 * Helper de logging coloreado para el Chain.
 *
 * Lema:
 *   - 4xx (cliente): amarillo, nivel warn. No es bug del servidor.
 *   - 5xx (servidor): rojo, nivel error. SÍ es bug del servidor → Loki.
 *   - errores no clasificados: magenta, error.
 *
 * `colors` solo añade ANSI a stdout; en producción Winston con `json` format
 * los ignora. Por tanto: pinta en dev, no rompe en prod.
 *
 * Esta clase recibe `LoggerPort` por constructor — cualquier impl funciona.
 *
 * @remarks
 * Strategy interna para correlación: cada método selecciona el logger con
 * `req.logger ?? this.logger`. Cuando `RequestContextMiddleware` ya inyectó
 * el `RequestContextLoggerDecorator` en `req.logger`, los logs heredan
 * automáticamente `requestId`, `method` y `path` del request. Si por algún
 * motivo `req.logger` no existe (ej. error antes del middleware), cae al
 * `LoggerPort` base sin crashear.
 */
export class ErrorLogger {
  public constructor(private readonly logger: LoggerPort) {}

  public client(err: ClientError, req: Request): void {
    const log = req.logger ?? this.logger;
    const tag = colors.yellow(`[CLIENT ${err.statusCode}]`);
    log.warn(`${tag} ${req.path} → ${err.message}`, {
      statusCode: err.statusCode,
      path: req.path,
      details: err.details,
    });
  }

  public server(err: ServerError, req: Request): void {
    const log = req.logger ?? this.logger;
    const tag = colors.red.bold(`[SERVER ${err.statusCode}]`);
    log.error(`${tag} ${req.path} → ${err.message}`, {
      statusCode: err.statusCode,
      path: req.path,
      stack: err.stack,
    });
  }

  public validation(req: Request, fields: unknown): void {
    const log = req.logger ?? this.logger;
    const tag = colors.yellow('[VALIDATION 400]');
    log.warn(`${tag} ${req.path}`, {
      statusCode: 400,
      path: req.path,
      fields,
    });
  }

  public mongo(req: Request, kind: string, message: string): void {
    const log = req.logger ?? this.logger;
    const statusCode = kind === 'DUPLICATE 11000' ? 409 : 400;
    const tag = colors.cyan(`[MONGO ${kind}]`);
    log.warn(`${tag} ${req.path} → ${message}`, {
      statusCode,
      path: req.path,
      kind,
    });
  }

  public unhandled(req: Request, err: unknown): void {
    const log = req.logger ?? this.logger;
    const tag = colors.magenta.bold('[UNHANDLED 500]');
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    log.error(`${tag} ${req.path} → ${msg}`, {
      statusCode: 500,
      path: req.path,
      stack,
    });
  }
}
