import { z } from 'zod';
import { CustomError } from '#domain/shared/errors';

/**
 * Catálogo cerrado de categorías de uploads. Cada categoría delimita una
 * subcarpeta dentro del prefijo `users/{slug}/...` en S3 y aplica reglas de
 * MIME + tamaño máximo en el momento de pedir el presigned URL.
 *
 * El enum es deliberadamente cerrado: cualquier valor distinto a éstos es
 * rechazado por Zod con 400, lo que evita "shadow categories" (`..`, `etc`,
 * etc.) inyectadas vía path traversal.
 */
export const STORAGE_CATEGORIES = ['avatars', 'documents', 'attachments'] as const;

export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

export const StorageCategorySchema = z.enum(STORAGE_CATEGORIES);

/**
 * Whitelist de MIME types por categoría. `null` indica "sin restricción"
 * (acepta cualquier `Content-Type` declarado por el cliente).
 *
 * Las extensiones del filename NO son fuente de verdad — el navegador puede
 * mentir. La validación efectiva ocurre en el momento de firmar el upload
 * URL comparando con el `Content-Type` que el cliente declara.
 */
export const STORAGE_CATEGORY_MIME_ALLOWLIST: Record<StorageCategory, readonly string[] | null> = {
  avatars: ['image/png', 'image/jpeg', 'image/webp'],
  documents: ['application/pdf'],
  attachments: null,
};

/**
 * Tamaño máximo en bytes admitido por categoría. Valor informativo para los
 * clientes; la enforcement real de `Content-Length` se documenta en P5 como
 * mejora futura (las condiciones de policy de presigned PUT no son
 * universalmente soportadas por todos los SDKs).
 */
export const STORAGE_CATEGORY_MAX_BYTES: Record<StorageCategory, number> = {
  avatars: 2 * 1024 * 1024,
  documents: 10 * 1024 * 1024,
  attachments: 50 * 1024 * 1024,
};

/**
 * Verifica que el `contentType` declarado por el cliente está permitido
 * para la categoría. Lanza 400 con mensaje explícito si la lista de la
 * categoría no incluye el tipo y la lista no es libre (`null`).
 *
 * @param category - Categoría destino.
 * @param contentType - MIME exacto enviado por el cliente.
 * @throws {CustomError} 400 si el MIME no está en la allowlist.
 */
export function assertMimeAllowed(category: StorageCategory, contentType: string): void {
  const allowed = STORAGE_CATEGORY_MIME_ALLOWLIST[category];
  if (allowed === null) return;
  if (!allowed.includes(contentType)) {
    throw CustomError.badRequest(
      `Content-Type '${contentType}' not allowed for category '${category}'`,
      { allowed },
    );
  }
}
