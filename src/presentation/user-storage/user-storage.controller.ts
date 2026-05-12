import type { Request, Response, NextFunction } from 'express';
import type { UserStorageFacade } from '#application/user-storage/user-storage.facade';
import type { UserQueryRepositoryPort } from '#domain/user/user.repository.port';
import type {
  RequestUploadUrlBodyDto,
  ListUserFilesQueryDto,
  DownloadUrlQueryDto,
} from '#domain/shared/storage/user-storage.dto';
import { ResponseFormatter } from '#domain/shared/response/response.formatter';
import { CustomError } from '#domain/shared/errors';

/**
 * HTTP boundary del subsistema user-storage.
 *
 * @remarks
 * - `self` (`/storage/me/*`) resuelve el `slug` del JWT autenticado.
 * - `admin` (`/storage/users/:id/*`) resuelve el `slug` del User indicado por
 *   `:id` (Mongo `_id` o `keycloak_id`, en ese orden).
 * - El path param `:key` viene base64url-encoded para soportar `/` internos.
 */
export class UserStorageController {
  public constructor(
    private readonly facade: UserStorageFacade,
    private readonly userQuery: UserQueryRepositoryPort,
  ) {}

  public requestUploadSelf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = await this.resolveSelfSlug(req);
      const body = req.body as RequestUploadUrlBodyDto;
      const result = await this.facade.requestUpload({
        userSlug: slug,
        category: body.category,
        originalFilename: body.filename,
        contentType: body.contentType,
        expiresInSeconds: body.expiresInSeconds,
      });
      res.status(200).json(ResponseFormatter.success('Upload URL issued', result));
    } catch (err) {
      next(err);
    }
  };

  public listSelf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = await this.resolveSelfSlug(req);
      const query = (req.validatedQuery ?? req.query) as ListUserFilesQueryDto;
      const result = await this.facade.list({
        userSlug: slug,
        category: query.category,
        maxKeys: query.maxKeys,
        continuationToken: query.continuationToken,
      });
      res.status(200).json(ResponseFormatter.success('Files listed', result));
    } catch (err) {
      next(err);
    }
  };

  public downloadSelf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = await this.resolveSelfSlug(req);
      const key = this.decodeKey(String(req.params.key));
      const query = (req.validatedQuery ?? req.query) as DownloadUrlQueryDto;
      const result = await this.facade.getDownloadUrl({
        userSlug: slug,
        key,
        expiresInSeconds: query.expiresIn,
      });
      res.status(200).json(ResponseFormatter.success('Download URL issued', result));
    } catch (err) {
      next(err);
    }
  };

  public deleteSelf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = await this.resolveSelfSlug(req);
      const key = this.decodeKey(String(req.params.key));
      await this.facade.deleteFile({ userSlug: slug, key });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  public requestUploadAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = await this.resolveTargetSlug(String(req.params.id));
      const body = req.body as RequestUploadUrlBodyDto;
      const result = await this.facade.requestUpload({
        userSlug: slug,
        category: body.category,
        originalFilename: body.filename,
        contentType: body.contentType,
        expiresInSeconds: body.expiresInSeconds,
      });
      res.status(200).json(ResponseFormatter.success('Upload URL issued', result));
    } catch (err) {
      next(err);
    }
  };

  public listAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = await this.resolveTargetSlug(String(req.params.id));
      const query = (req.validatedQuery ?? req.query) as ListUserFilesQueryDto;
      const result = await this.facade.list({
        userSlug: slug,
        category: query.category,
        maxKeys: query.maxKeys,
        continuationToken: query.continuationToken,
      });
      res.status(200).json(ResponseFormatter.success('Files listed', result));
    } catch (err) {
      next(err);
    }
  };

  public downloadAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = await this.resolveTargetSlug(String(req.params.id));
      const key = this.decodeKey(String(req.params.key));
      const query = (req.validatedQuery ?? req.query) as DownloadUrlQueryDto;
      const result = await this.facade.getDownloadUrl({
        userSlug: slug,
        key,
        expiresInSeconds: query.expiresIn,
      });
      res.status(200).json(ResponseFormatter.success('Download URL issued', result));
    } catch (err) {
      next(err);
    }
  };

  public deleteAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = await this.resolveTargetSlug(String(req.params.id));
      const key = this.decodeKey(String(req.params.key));
      await this.facade.deleteFile({ userSlug: slug, key });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  private async resolveSelfSlug(req: Request): Promise<string> {
    if (!req.user?.id) throw CustomError.unauthorized();
    const user = await this.userQuery.findByKeycloakId(req.user.id);
    if (!user) throw CustomError.notFound('User not found');
    return user.slug;
  }

  private async resolveTargetSlug(idOrSub: string): Promise<string> {
    const objectIdLike = /^[a-fA-F0-9]{24}$/.test(idOrSub);
    const user = objectIdLike
      ? (await this.userQuery.findById(idOrSub)) ?? (await this.userQuery.findByKeycloakId(idOrSub))
      : (await this.userQuery.findByKeycloakId(idOrSub)) ?? (await this.userQuery.findById(idOrSub));
    if (!user) throw CustomError.notFound('User not found');
    return user.slug;
  }

  private decodeKey(encoded: string): string {
    try {
      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
      if (!decoded) throw new Error('empty');
      return decoded;
    } catch {
      throw CustomError.badRequest('Invalid key encoding');
    }
  }
}
