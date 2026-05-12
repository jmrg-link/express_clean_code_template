import { z } from 'zod';
import { StorageCategorySchema } from './storage-categories.js';

/**
 * Body para `POST /storage/me/upload-url` y la variante admin.
 *
 * @remarks
 * `filename` mantiene el nombre original (slugificado server-side por
 * `StorageKeyBuilder`). `contentLength` es informativo — el SDK actual no
 * firma `Content-Length` por defecto.
 */
export const RequestUploadUrlBodySchema = z.object({
  category: StorageCategorySchema,
  filename: z.string().min(1).max(255),
  contentType: z.string().min(3).max(127),
  contentLength: z.number().int().positive().optional(),
  expiresInSeconds: z.coerce.number().int().min(60).max(900).default(900),
});
export type RequestUploadUrlBodyDto = z.infer<typeof RequestUploadUrlBodySchema>;

/**
 * Query params para `GET /storage/me` y la variante admin. Paginado opcional.
 */
export const ListUserFilesQuerySchema = z.object({
  category: StorageCategorySchema.optional(),
  maxKeys: z.coerce.number().int().positive().max(1000).default(100),
  continuationToken: z.string().min(1).optional(),
});
export type ListUserFilesQueryDto = z.infer<typeof ListUserFilesQuerySchema>;

/**
 * Path param `:key` codificado en base64url. El controller decodifica antes
 * de pasarlo al use-case.
 */
export const EncodedKeyParamSchema = z.object({
  key: z.string().min(1).max(1024),
});
export type EncodedKeyParamDto = z.infer<typeof EncodedKeyParamSchema>;

/**
 * Path param `:id` admin. Acepta Mongo `_id` (24 hex) o keycloak `sub` (UUID).
 * El controller intenta `findById` primero y cae a `findByKeycloakId`.
 */
export const AdminUserIdParamSchema = z.object({
  id: z.string().min(1).max(64),
});
export type AdminUserIdParamDto = z.infer<typeof AdminUserIdParamSchema>;

/**
 * Query param `expiresIn` opcional para los endpoints download-url.
 */
export const DownloadUrlQuerySchema = z.object({
  expiresIn: z.coerce.number().int().min(60).max(900).default(900),
});
export type DownloadUrlQueryDto = z.infer<typeof DownloadUrlQuerySchema>;
