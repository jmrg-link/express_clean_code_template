import { CustomError } from '#domain/shared/errors';

/**
 * Validación defensiva de keys S3 antes de pasar al adapter.
 *
 * @remarks
 * Bloquea:
 *  - keys vacías,
 *  - intento de path traversal (`..` en cualquier segmento),
 *  - prefijo `/` (absolute path).
 *
 * No se valida que la key empiece con un prefix concreto: esa regla es
 * propia del use-case (ownership). Aquí solo lo común a cualquier key.
 */
export const StorageKeyValidator = {
  assertSafe(key: string): void {
    if (!key || key.includes('..') || key.startsWith('/')) {
      throw CustomError.badRequest('Invalid object key');
    }
  },
};
