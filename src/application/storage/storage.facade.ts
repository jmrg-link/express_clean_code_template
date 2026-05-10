import type { StoragePort, ListObjectsInput, ListObjectsResult } from '#domain/shared/storage/storage.port';
import { ListStorageObjectsUseCase } from './use-cases/list-storage-objects.use-case.js';
import { GetSignedUrlUseCase } from './use-cases/get-signed-url.use-case.js';

/**
 * Facade del subsistema Storage.
 *
 * Mismo patrón que UserFacade/AuthFacade: el controller depende de UNA cosa,
 * la facade compone los use-cases.
 */
export class StorageFacade {
  private readonly listUC: ListStorageObjectsUseCase;
  private readonly signUC: GetSignedUrlUseCase;

  public constructor(storage: StoragePort) {
    this.listUC = new ListStorageObjectsUseCase(storage);
    this.signUC = new GetSignedUrlUseCase(storage);
  }

  public list(input?: ListObjectsInput): Promise<ListObjectsResult> {
    return this.listUC.execute(input);
  }

  public getSignedUrl(key: string, expiresIn?: number): Promise<{ url: string; expiresIn: number }> {
    return this.signUC.execute(key, expiresIn);
  }
}
