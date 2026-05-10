import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { CustomError } from '#domain/shared/errors';

const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

/**
 * Valida que `req.params[paramName]` sea un ObjectId hex de 24 chars.
 * Evita pegarle a Mongo con un id mal formado y deja un 400 limpio
 * antes que un CastError.
 */
export const validateObjectId = (paramName = 'id'): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const raw = req.params[paramName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || !OBJECT_ID_REGEX.test(value)) {
      return next(
        CustomError.badRequest(`Invalid ${paramName}: must be a 24-character hex string`),
      );
    }
    next();
  };
};
