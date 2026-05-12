import type { StoragePort } from '#domain/shared/storage/storage.port';
import { StorageKeyValidator } from '#domain/shared/storage/storage-key.validator';
import { CustomError } from '#domain/shared/errors';

export interface GetDownloadUrlInput {
  userSlug: string;
  key: string;
  expiresInSeconds?: number;
}

export interface DownloadUrlResult {
  url: string;
  expiresIn: number;
}

/**
 * Genera URL prefirmada GET para una key concreta, restringido a que la key
 * pertenezca al `userSlug` indicado (defensa en profundidad sobre el control
 * que ya hace el controller de presentación).
 */
export class GetDownloadUrlUseCase {
  public constructor(private readonly storage: StoragePort) {}

  public async execute(input: GetDownloadUrlInput): Promise<DownloadUrlResult> {
    StorageKeyValidator.assertSafe(input.key);
    if (!input.key.startsWith(`users/${input.userSlug}/`)) {
      throw CustomError.forbidden('Key does not belong to user');
    }
    const expiresIn = input.expiresInSeconds ?? 900;
    const url = await this.storage.getSignedDownloadUrl(input.key, expiresIn);
    return { url, expiresIn };
  }
}
