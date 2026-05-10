import { ClientError, ServerError } from './base.error.js';

/**
 * Fachada de factories. Mantiene la API anterior (`CustomError.badRequest(...)`)
 * pero internamente devuelve la rama correcta para que el Chain handler la
 * coloree distinto.
 *
 * Razón de mantenerlo como CLASE con statics y no como objeto:
 *  - `CustomError.notFound(...)` se autocompleta mejor en IDE.
 *  - Si mañana añadimos hooks (Sentry capture, métricas), centralizamos aquí.
 */
export class CustomError {
  public static badRequest(message: string, details?: unknown): ClientError {
    return new ClientError(400, message, details);
  }

  public static unauthorized(message = 'Unauthorized'): ClientError {
    return new ClientError(401, message);
  }

  public static forbidden(message = 'Forbidden'): ClientError {
    return new ClientError(403, message);
  }

  public static notFound(message = 'Not found'): ClientError {
    return new ClientError(404, message);
  }

  public static conflict(message: string, details?: unknown): ClientError {
    return new ClientError(409, message, details);
  }

  public static unprocessable(message: string, details?: unknown): ClientError {
    return new ClientError(422, message, details);
  }

  public static tooManyRequests(message = 'Too many requests'): ClientError {
    return new ClientError(429, message);
  }

  public static internal(message = 'Internal server error', details?: unknown): ServerError {
    return new ServerError(500, message, details);
  }

  public static badGateway(message = 'Bad gateway', details?: unknown): ServerError {
    return new ServerError(502, message, details);
  }

  public static serviceUnavailable(message = 'Service unavailable', details?: unknown): ServerError {
    return new ServerError(503, message, details);
  }
}
