import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '#config/env';
import type {
  StoragePort,
  StorageObject,
  ListObjectsInput,
  ListObjectsResult,
} from '#domain/shared/storage/storage.port';
import { CustomError } from '#domain/shared/errors';
import type { LoggerPort } from '#domain/shared/logger/logger.port';

/**
 * Adapter S3 que implementa `StoragePort`.
 *
 * Patrón Adapter (estructural): el dominio habla `StoragePort`, AWS habla
 * `S3Client`; este archivo es el traductor.
 *
 * Patrón Singleton/Factory: `S3StorageAdapter.create()` instancia el
 * `S3Client` UNA VEZ y guarda la referencia. La idea es que se inyecte por
 * DI en cualquier use-case que lo necesite (no se importe globalmente).
 *
 * Inicialización defensiva: si `env.s3.isConfigured` es false (ej. local
 * sin credenciales), `create` lanza ServerError con mensaje claro. main.ts
 * solo intenta crearlo si está configurado y, si no, NO ata el endpoint.
 */
export class S3StorageAdapter implements StoragePort {
  private constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly logger: LoggerPort,
  ) {}

  public static create(logger: LoggerPort): S3StorageAdapter {
    if (!env.s3.isConfigured || !env.s3.bucket) {
      throw CustomError.internal(
        'S3 is not configured: missing AWS_S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY',
      );
    }
    const config: S3ClientConfig = {
      region: env.s3.region,
      credentials: {
        accessKeyId: env.s3.accessKeyId!,
        secretAccessKey: env.s3.secretAccessKey!,
      },
      forcePathStyle: env.s3.forcePathStyle,
    };
    if (env.s3.endpoint) config.endpoint = env.s3.endpoint;

    const client = new S3Client(config);
    logger.info('S3 storage adapter initialized', {
      bucket: env.s3.bucket,
      region: env.s3.region,
      endpoint: env.s3.endpoint ?? '(default AWS)',
    });
    return new S3StorageAdapter(client, env.s3.bucket, logger);
  }

  public async listObjects(input: ListObjectsInput = {}): Promise<ListObjectsResult> {
    try {
      const cmd = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: input.prefix,
        MaxKeys: input.maxKeys ?? 100,
        ContinuationToken: input.continuationToken,
      });
      const res = await this.client.send(cmd);

      const objects: StorageObject[] = (res.Contents ?? []).map((c) => ({
        key: c.Key ?? '',
        size: c.Size ?? 0,
        lastModified: c.LastModified ?? new Date(0),
        etag: c.ETag?.replaceAll('"', ''),
      }));

      return {
        objects,
        nextContinuationToken: res.NextContinuationToken,
        isTruncated: Boolean(res.IsTruncated),
      };
    } catch (err) {
      this.logger.error('S3 listObjects failed', { error: (err as Error).message });
      throw CustomError.badGateway('Storage list operation failed');
    }
  }

  public async getSignedDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    try {
      const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      return await getSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
    } catch (err) {
      this.logger.error('S3 signed url generation failed', { key, error: (err as Error).message });
      throw CustomError.badGateway('Storage signed-url generation failed');
    }
  }

  public async putObject(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } catch (err) {
      this.logger.error('S3 putObject failed', { key, error: (err as Error).message });
      throw CustomError.badGateway('Storage put operation failed');
    }
  }

  public async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      this.logger.error('S3 deleteObject failed', { key, error: (err as Error).message });
      throw CustomError.badGateway('Storage delete operation failed');
    }
  }
}
