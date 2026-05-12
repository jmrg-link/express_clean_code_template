import type { StoragePort } from '#domain/shared/storage/storage.port';
import { StorageKeyValidator } from '#domain/shared/storage/storage-key.validator';
import { CustomError } from '#domain/shared/errors';

export interface DeleteUserFileInput {
  userSlug: string;
  key: string;
}

/**
 * Borra un objeto del storage validando que pertenece al `userSlug`. Devuelve
 * `void`. Idempotente — borrar una key inexistente no es error.
 */
export class DeleteUserFileUseCase {
  public constructor(private readonly storage: StoragePort) {}

  public async execute(input: DeleteUserFileInput): Promise<void> {
    StorageKeyValidator.assertSafe(input.key);
    if (!input.key.startsWith(`users/${input.userSlug}/`)) {
      throw CustomError.forbidden('Key does not belong to user');
    }
    await this.storage.deleteObject(input.key);
  }
}
