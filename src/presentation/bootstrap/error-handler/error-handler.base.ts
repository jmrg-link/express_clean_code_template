import type { Request, Response, NextFunction } from 'express';

/**
 * Eslabón base del Chain of Responsibility.
 *
 * Cada handler:
 *  - recibe el error.
 *  - si lo reconoce, responde y corta la cadena.
 *  - si no, llama a `delegate` para pasarlo al siguiente.
 *
 * El último (FallbackErrorHandler) siempre responde 500.
 *
 * Beneficios sobre un switch gigante:
 *  - SRP: cada handler una sola responsabilidad.
 *  - OCP: añadir tipos (Stripe, S3) = añadir handler sin tocar los demás.
 *  - Testeable en aislamiento.
 */
export abstract class ErrorHandler {
  protected next?: ErrorHandler;

  public setNext(handler: ErrorHandler): ErrorHandler {
    this.next = handler;
    return handler;
  }

  /** Cada eslabón implementa su lógica concreta. */
  public abstract handle(err: unknown, req: Request, res: Response, nxt: NextFunction): void;

  protected delegate(err: unknown, req: Request, res: Response, nxt: NextFunction): void {
    if (this.next) this.next.handle(err, req, res, nxt);
    else nxt(err);
  }
}
