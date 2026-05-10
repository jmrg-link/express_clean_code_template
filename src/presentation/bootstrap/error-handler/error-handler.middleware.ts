import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { ClientError, ServerError } from '#domain/shared/errors';
import { ResponseFormatter } from '#domain/shared/response/response.formatter';
import type { LoggerPort } from '#domain/shared/logger/logger.port';
import { ErrorHandler } from './error-handler.base.js';
import { ErrorLogger } from './error-logger.js';

/**
 * Eslabón previo: `SyntaxError` propagado por `express.json()` ante un body
 * JSON malformado (trailing comma, comillas omitidas, EOF prematuro, …).
 *
 * @remarks
 * Sin este handler, body-parser produce un `SyntaxError` con `status: 400`
 * que cae al fallback genérico y termina como `500 Internal server error`.
 * Aquí lo mapeamos a `400 Bad Request` con el detalle original (truncado
 * a 200 chars) para que el cliente sepa qué arreglar.
 */
class BodyParseErrorHandler extends ErrorHandler {
  public constructor(private readonly elog: ErrorLogger) {
    super();
  }

  public handle(err: unknown, req: Request, res: Response, nxt: NextFunction): void {
    if (BodyParseErrorHandler.isBodyParseError(err)) {
      const detail = err.message.slice(0, 200);
      this.elog.client(new ClientError(400, 'Malformed request body', { detail }), req.path);
      res
        .status(400)
        .json(ResponseFormatter.error('Malformed request body', [{ detail }]));
      return;
    }
    this.delegate(err, req, res, nxt);
  }

  private static isBodyParseError(err: unknown): err is SyntaxError {
    if (!(err instanceof SyntaxError)) return false;
    const status = (err as { status?: unknown }).status;
    const type = (err as { type?: unknown }).type;
    return status === 400 || type === 'entity.parse.failed';
  }
}

class ZodErrorHandler extends ErrorHandler {
  public constructor(private readonly elog: ErrorLogger) {
    super();
  }
  public handle(err: unknown, req: Request, res: Response, nxt: NextFunction): void {
    if (err instanceof ZodError) {
      const errors = err.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      this.elog.validation(req.path, errors);
      res.status(400).json(ResponseFormatter.error('Validation error', errors));
      return;
    }
    this.delegate(err, req, res, nxt);
  }
}

class ClientErrorHandler extends ErrorHandler {
  public constructor(private readonly elog: ErrorLogger) {
    super();
  }
  public handle(err: unknown, req: Request, res: Response, nxt: NextFunction): void {
    if (err instanceof ClientError) {
      this.elog.client(err, req.path);
      const body = ResponseFormatter.error(err.message);
      const payload = err.details ? { ...body, errors: [err.details] } : body;
      res.status(err.statusCode).json(payload);
      return;
    }
    this.delegate(err, req, res, nxt);
  }
}

class ServerErrorHandler extends ErrorHandler {
  public constructor(private readonly elog: ErrorLogger) {
    super();
  }
  public handle(err: unknown, req: Request, res: Response, nxt: NextFunction): void {
    if (err instanceof ServerError) {
      this.elog.server(err, req.path);
      res.status(err.statusCode).json(ResponseFormatter.error(err.message));
      return;
    }
    this.delegate(err, req, res, nxt);
  }
}

class MongoErrorHandler extends ErrorHandler {
  public constructor(private readonly elog: ErrorLogger) {
    super();
  }
  public handle(err: unknown, req: Request, res: Response, nxt: NextFunction): void {
    if (err instanceof mongoose.mongo.MongoServerError && err.code === 11000) {
      const field = Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {})[0] ?? 'field';
      this.elog.mongo(req.path, 'DUPLICATE 11000', `field=${field}`);
      res.status(409).json(ResponseFormatter.error(`Duplicate value for '${field}'`));
      return;
    }
    if (err instanceof mongoose.Error.ValidationError) {
      const errors = Object.values(err.errors).map((e) => ({
        field: e.path,
        message: e.message,
      }));
      this.elog.mongo(req.path, 'VALIDATION', JSON.stringify(errors));
      res.status(400).json(ResponseFormatter.error('Validation error', errors));
      return;
    }
    if (err instanceof mongoose.Error.CastError) {
      const msg = `Invalid ${err.path}: ${String(err.value)}`;
      this.elog.mongo(req.path, 'CAST', msg);
      res.status(400).json(ResponseFormatter.error(msg));
      return;
    }
    this.delegate(err, req, res, nxt);
  }
}

class FallbackErrorHandler extends ErrorHandler {
  public constructor(private readonly elog: ErrorLogger) {
    super();
  }
  public handle(err: unknown, req: Request, res: Response, _nxt: NextFunction): void {
    this.elog.unhandled(req.path, err);
    res.status(500).json(ResponseFormatter.error('Internal server error'));
  }
}

/**
 * Factory que arma la cadena UNA VEZ y devuelve el ErrorRequestHandler que
 * Express espera (firma de 4 args).
 *
 * Recibe `LoggerPort` por DI: la cadena entera es agnóstica al impl concreto.
 */
export class ErrorHandlerMiddleware {
  public static build(logger: LoggerPort): ErrorRequestHandler {
    const elog = new ErrorLogger(logger);
    const bodyParse = new BodyParseErrorHandler(elog);
    const zod = new ZodErrorHandler(elog);
    const client = new ClientErrorHandler(elog);
    const server = new ServerErrorHandler(elog);
    const mongo = new MongoErrorHandler(elog);
    const fallback = new FallbackErrorHandler(elog);

    bodyParse.setNext(zod).setNext(client).setNext(server).setNext(mongo).setNext(fallback);

    return (err, req, res, next) => bodyParse.handle(err, req, res, next);
  }
}
