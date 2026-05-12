import type {
  ListObjectsResult,
  StoragePort,
} from '#domain/shared/storage/storage.port';
import { StorageCategorySchema, type StorageCategory } from '#domain/shared/storage/storage-categories';

export type { ListObjectsResult } from '#domain/shared/storage/storage.port';

export interface ListUserFilesInput {
  userSlug: string;
  category?: StorageCategory;
  maxKeys?: number;
  continuationToken?: string;
}

/**
 * Lista paginada de objetos bajo `users/{userSlug}/[{category}/]`. Si se
 * pasa `category`, se valida contra el enum cerrado y se restringe el prefix.
 */
export class ListUserFilesUseCase {
  public constructor(private readonly storage: StoragePort) {}

  public async execute(input: ListUserFilesInput): Promise<ListObjectsResult> {
    const categoryPart = input.category
      ? `${StorageCategorySchema.parse(input.category)}/`
      : '';
    const prefix = `users/${input.userSlug}/${categoryPart}`;
    return this.storage.listObjects({
      prefix,
      maxKeys: input.maxKeys,
      continuationToken: input.continuationToken,
    });
  }
}
