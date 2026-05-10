/**
 * Jerarquía de errores del dominio.
 *
 * Diseño:
 *  - `BaseError` es abstracta y nunca se instancia directamente.
 *  - `ClientError` (4xx) y `ServerError` (5xx) son las dos ramas que el
 *    Chain of Responsibility usará para colorear el log distinto:
 *    cliente → amarillo (warn), servidor → rojo (error fatal).
 *  - `CustomError` mantiene la API de factories (badRequest/notFound/...) que
 *    el equipo ya conocía del repo anterior — pero internamente se enruta
 *    como subclase de la rama correcta.
 *
 * Ventaja sobre el shape de cuimo (`new Error(); e.statusCode = 401`):
 *  - Tipado estricto: `if (err instanceof ClientError)` no requiere casts.
 *  - El Chain handler puede decidir el log level por rama, no por número.
 *  - Subclases específicas (UserNotFoundError, KeycloakUnavailableError) heredan
 *    el statusCode correcto sin pasarlo en cada throw.
 */
export abstract class BaseError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  protected constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace?.(this, new.target);
  }
}

/** 4xx: el cliente envió algo mal. Se loguea como warn, no como error. */
export class ClientError extends BaseError {
  public constructor(statusCode: number, message: string, details?: unknown) {
    super(statusCode, message, details);
  }
}

/** 5xx: algo falló en el servidor. Se loguea como error con stack. */
export class ServerError extends BaseError {
  public constructor(statusCode: number, message: string, details?: unknown) {
    super(statusCode, message, details);
  }
}
