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
