import colors from 'colors';
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
 */
export class ErrorLogger {
  public constructor(private readonly logger: LoggerPort) {}

  public client(err: ClientError, requestPath: string): void {
    const tag = colors.yellow(`[CLIENT ${err.statusCode}]`);
    this.logger.warn(`${tag} ${requestPath} → ${err.message}`, {
      statusCode: err.statusCode,
      path: requestPath,
      details: err.details,
    });
  }

  public server(err: ServerError, requestPath: string): void {
    const tag = colors.red.bold(`[SERVER ${err.statusCode}]`);
    this.logger.error(`${tag} ${requestPath} → ${err.message}`, {
      statusCode: err.statusCode,
      path: requestPath,
      stack: err.stack,
    });
  }

  public validation(requestPath: string, fields: unknown): void {
    const tag = colors.yellow('[VALIDATION 400]');
    this.logger.warn(`${tag} ${requestPath}`, { path: requestPath, fields });
  }

  public mongo(requestPath: string, kind: string, message: string): void {
    const tag = colors.cyan(`[MONGO ${kind}]`);
    this.logger.warn(`${tag} ${requestPath} → ${message}`, { path: requestPath, kind });
  }

  public unhandled(requestPath: string, err: unknown): void {
    const tag = colors.magenta.bold('[UNHANDLED 500]');
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    this.logger.error(`${tag} ${requestPath} → ${msg}`, { path: requestPath, stack });
  }
}
