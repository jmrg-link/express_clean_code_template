import type { StoragePort } from '#domain/shared/storage/storage.port';
import { StorageKeyBuilder } from '#domain/shared/storage/storage-key.builder';
import {
  assertMimeAllowed,
  StorageCategorySchema,
  type StorageCategory,
} from '#domain/shared/storage/storage-categories';

export interface RequestUploadUrlInput {
  userSlug: string;
  category: StorageCategory;
  originalFilename: string;
  contentType: string;
  expiresInSeconds?: number;
}

export interface UploadUrlResult {
  uploadUrl: string;
  key: string;
  expiresAt: string;
}

/**
 * Devuelve una URL prefirmada (PUT directo a S3) + la key destino + el
 * instante de expiración (ISO 8601). Categoría y MIME validados al borde;
 * la key se construye server-side a partir de `userSlug` + categoría.
 */
export class RequestUploadUrlUseCase {
  public constructor(private readonly storage: StoragePort) {}

  public async execute(input: RequestUploadUrlInput): Promise<UploadUrlResult> {
    const category = StorageCategorySchema.parse(input.category);
    assertMimeAllowed(category, input.contentType);
    const key = StorageKeyBuilder.build({
      userSlug: input.userSlug,
      category,
      originalFilename: input.originalFilename,
    });
    const expiresInSeconds = input.expiresInSeconds ?? 900;
    const uploadUrl = await this.storage.getSignedUploadUrl(key, input.contentType, expiresInSeconds);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    return { uploadUrl, key, expiresAt };
  }
}
