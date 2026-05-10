import type { LoggerPort, LogMeta } from '#domain/shared/logger/logger.port';

/**
 * Decorator (estructural) sobre `LoggerPort`.
 *
 * Envuelve un logger existente y añade automáticamente bindings de contexto
 * (requestId, userId, route…) a CADA log line. El consumer no se entera —
 * tipa `LoggerPort` igual que antes.
 *
 * Cómo se usa:
 *
 *   const reqLogger = new RequestContextLoggerDecorator(baseLogger, {
 *     requestId: req.id,
 *     userId: req.user?.id,
 *   });
 *   reqLogger.info('processing payment'); // sale con requestId+userId mergeados
 *
 * Patrón Decorator: implementa la MISMA interfaz que envuelve, así puede
 * ponerse delante de WinstonLoggerAdapter o de cualquier otro logger
 * (incluso de OTRO decorator) sin romper el contrato.
 */
export class RequestContextLoggerDecorator implements LoggerPort {
  public constructor(
    private readonly inner: LoggerPort,
    private readonly bindings: LogMeta,
  ) {}

  public debug(message: string, meta?: LogMeta): void {
    this.inner.debug(message, this.merge(meta));
  }

  public info(message: string, meta?: LogMeta): void {
    this.inner.info(message, this.merge(meta));
  }

  public warn(message: string, meta?: LogMeta): void {
    this.inner.warn(message, this.merge(meta));
  }

  public error(message: string, meta?: LogMeta): void {
    this.inner.error(message, this.merge(meta));
  }

  public child(extraBindings: LogMeta): LoggerPort {
    return new RequestContextLoggerDecorator(this.inner, { ...this.bindings, ...extraBindings });
  }

  private merge(meta?: LogMeta): LogMeta {
    return meta ? { ...this.bindings, ...meta } : { ...this.bindings };
  }
}
