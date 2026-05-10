import type { PaginationMeta } from '../paginator/pagination.dto.js';

/**
 * Formato uniforme de respuestas JSON. Mismo shape que cuimo:
 *   { message, data, pagination? }
 *
 * Se exporta como funciones puras (no clase) porque no tienen estado y
 * un objeto literal de helpers se imprime más limpio en stack traces.
 */

export interface SuccessResponse<T> {
  message: string;
  data: T;
  pagination?: PaginationMeta;
}

export interface ErrorResponse {
  message: string;
  errors?: unknown[];
}

export const ResponseFormatter = {
  success<T>(message: string, data: T, pagination?: PaginationMeta): SuccessResponse<T> {
    return pagination ? { message, data, pagination } : { message, data };
  },

  error(message: string, errors?: unknown[]): ErrorResponse {
    return errors ? { message, errors } : { message };
  },
};
