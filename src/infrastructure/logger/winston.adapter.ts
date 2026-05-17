import winston, { type Logger as WinstonLogger } from 'winston';
import { env } from '#config/env';
import type { LoggerPort, LogMeta } from '#domain/shared/logger/logger.port';

/**
 * Adapter Winston que implementa `LoggerPort`.
 *
 * Patrón Adapter (estructural): traduce el contrato del dominio (LoggerPort)
 * a la API de Winston. Si mañana cambiamos a Pino, solo cambia este archivo.
 *
 * Patrón Strategy (comportamiento) interno: el formato y los transports se
 * eligen según `nodeEnv`:
 *   - dev/local/test → Console con colores (legible).
 *   - staging/production → Console JSON + Loki si está configurado.
 *
 * Patrón Singleton/Factory: `WinstonLoggerAdapter.create()` instancia una
 * sola vez la base; los hijos comparten el transport.
 */
export class WinstonLoggerAdapter implements LoggerPort {
  private constructor(private readonly logger: WinstonLogger) {}

  /**
   * Construye el logger Winston con transports Console + Loki (si LOKI_HOST set).
   *
   * @remarks
   * Política de labels Loki — baja cardinalidad obligatoria. Labels permitidos
   * como dimensiones: `{app, env}`. Nunca añadir requestId, userId, route,
   * statusCode, ip como label estático: explotan el TSDB de Loki. Esos campos
   * van en el cuerpo JSON via `request-context.decorator.ts` y se queryan con
   * `| json | <campo>="<valor>"` en LogQL.
   *
   * El `LokiTransport` recibe su propio `format: winston.format.json()` para
   * serializar el info object como JSON puro top-level. Sin esto, el transport
   * concatena `message + JSON.stringify(meta)` en una string text-style que
   * rompe `| json` en Loki (JSONParserErr al 100%).
   */
  public static async create(): Promise<WinstonLoggerAdapter> {
    const { combine, timestamp, printf, colorize, json, errors } = winston.format;

    const devFormat = combine(
      colorize(),
      timestamp({ format: 'HH:mm:ss' }),
      errors({ stack: true }),
      printf((info) => {
        const { level, message, timestamp: ts, ...rest } = info;
        const meta = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
        return `${ts} ${level}: ${message}${meta}`;
      }),
    );

    const prodFormat = combine(timestamp(), errors({ stack: true }), json());

    const transports: winston.transport[] = [new winston.transports.Console()];

    if ((env.server.isProduction || env.server.isStaging) && env.loki.host) {
      const LokiTransport = (await import('winston-loki')).default;
      const lokiErrorThrottle = ((): ((err: Error) => void) => {
        let lastErrAt = 0;
        return (err: Error) => {
          if (Date.now() - lastErrAt < 60_000) return;
          lastErrAt = Date.now();
          process.stderr.write(`[loki] push failed: ${err.message}\n`);
        };
      })();

      transports.push(
        new LokiTransport({
          host: env.loki.host,
          labels: {
            app: 'express-clean-backend',
            env: env.server.nodeEnv,
          },
          json: true,
          batching: true,
          interval: 5,
          timeout: 30_000,
          format: winston.format.json(),
          onConnectionError: lokiErrorThrottle,
        }) as unknown as winston.transport,
      );
    }

    const winstonInstance = winston.createLogger({
      level: env.server.isDevelopment ? 'debug' : 'info',
      format: env.server.isDevelopment ? devFormat : prodFormat,
      transports,
      exitOnError: false,
    });

    return new WinstonLoggerAdapter(winstonInstance);
  }

  public debug(message: string, meta?: LogMeta): void {
    this.logger.debug(message, meta);
  }

  public info(message: string, meta?: LogMeta): void {
    this.logger.info(message, meta);
  }

  public warn(message: string, meta?: LogMeta): void {
    this.logger.warn(message, meta);
  }

  public error(message: string, meta?: LogMeta): void {
    this.logger.error(message, meta);
  }

  public child(bindings: LogMeta): LoggerPort {
    const childLogger = this.logger.child(bindings);
    return new WinstonLoggerAdapter(childLogger);
  }
}
