import type { Request, Response, NextFunction } from 'express';
import type { StorageFacade } from '#application/storage/storage.facade';
import { ResponseFormatter } from '#domain/shared/response/response.formatter';
import type { ListStorageQueryDto, SignedUrlParamsDto } from '#domain/shared/storage/storage.dto';

export class StorageController {
  public constructor(private readonly facade: StorageFacade) {}

  public list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = (req.validatedQuery ?? req.query) as ListStorageQueryDto;
      const result = await this.facade.list(dto);
      res.status(200).json(ResponseFormatter.success('Objects listed successfully', result));
    } catch (err) {
      next(err);
    }
  };

  public sign = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = (req.validatedQuery ?? req.query) as SignedUrlParamsDto;
      const result = await this.facade.getSignedUrl(dto.key, dto.expiresIn);
      res.status(200).json(ResponseFormatter.success('Signed URL generated', result));
    } catch (err) {
      next(err);
    }
  };
}
