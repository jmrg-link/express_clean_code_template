/**
 * Puerto del logger en el dominio.
 *
 * Ningún use-case ni controller debería tipar `import { logger } from '#config/logger'`.
 * Tipan `LoggerPort` y reciben la implementación por DI. Eso permite:
 *   - Mockear logging en tests (silenciar o capturar líneas).
 *   - Decorar el logger con context (request-id, user-id) sin tocar consumers.
 *   - Cambiar Winston por Pino o por una API HTTP sin tocar el dominio.
 *
 * `meta` es un sobre opcional para campos estructurados (compatible con
 * el `json` format de Winston y con las labels de Loki).
 */
export type LogMeta = Record<string, unknown>;

export interface LoggerPort {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  /** Devuelve un logger hijo con metadata fijada (request-id, user-id, etc.). */
  child(bindings: LogMeta): LoggerPort;
}
