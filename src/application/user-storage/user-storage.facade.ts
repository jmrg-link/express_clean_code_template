import type { StoragePort, ListObjectsResult } from '#domain/shared/storage/storage.port';

import {
  RequestUploadUrlUseCase,
  type RequestUploadUrlInput,
  type UploadUrlResult,
} from './use-cases/request-upload-url.use-case.js';
import {
  ListUserFilesUseCase,
  type ListUserFilesInput,
} from './use-cases/list-user-files.use-case.js';
import {
  GetDownloadUrlUseCase,
  type GetDownloadUrlInput,
  type DownloadUrlResult,
} from './use-cases/get-download-url.use-case.js';
import {
  DeleteUserFileUseCase,
  type DeleteUserFileInput,
} from './use-cases/delete-user-file.use-case.js';

/**
 * Facade del subsistema de uploads por usuario. Compone los cuatro casos de
 * uso (request upload, list, download, delete) y expone una API plana al
 * controller. Sin lógica de negocio — solo delegación.
 *
 * El facade es agnóstico al actor: tanto `self` como `admin` consumen los
 * mismos métodos pasando el `userSlug` que ya resolvió el controller.
 */
export class UserStorageFacade {
  private readonly requestUploadUC: RequestUploadUrlUseCase;
  private readonly listUC: ListUserFilesUseCase;
  private readonly downloadUC: GetDownloadUrlUseCase;
  private readonly deleteUC: DeleteUserFileUseCase;

  public constructor(storage: StoragePort) {
    this.requestUploadUC = new RequestUploadUrlUseCase(storage);
    this.listUC = new ListUserFilesUseCase(storage);
    this.downloadUC = new GetDownloadUrlUseCase(storage);
    this.deleteUC = new DeleteUserFileUseCase(storage);
  }

  public requestUpload(input: RequestUploadUrlInput): Promise<UploadUrlResult> {
    return this.requestUploadUC.execute(input);
  }

  public list(input: ListUserFilesInput): Promise<ListObjectsResult> {
    return this.listUC.execute(input);
  }

  public getDownloadUrl(input: GetDownloadUrlInput): Promise<DownloadUrlResult> {
    return this.downloadUC.execute(input);
  }

  public deleteFile(input: DeleteUserFileInput): Promise<void> {
    return this.deleteUC.execute(input);
  }
}
