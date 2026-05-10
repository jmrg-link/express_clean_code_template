import type { StoragePort } from '#domain/shared/storage/storage.port';
import { CustomError } from '#domain/shared/errors';

export class GetSignedUrlUseCase {
  public constructor(private readonly storage: StoragePort) {}

  public async execute(key: string, expiresInSeconds = 900): Promise<{ url: string; expiresIn: number }> {
    if (!key || key.includes('..')) throw CustomError.badRequest('Invalid object key');
    const url = await this.storage.getSignedDownloadUrl(key, expiresInSeconds);
    return { url, expiresIn: expiresInSeconds };
  }
}
