/**
 * Puerto de almacenamiento de objetos (blob storage).
 *
 * No es "puerto S3" — es "puerto storage". Mañana cambias S3 por GCS o
 * Azure Blob y solo cambia el adapter en infrastructure.
 *
 * Operaciones cubiertas:
 *   - listObjects: para admin/dashboards.
 *   - getSignedDownloadUrl: para entregar URLs firmadas al cliente.
 *   - putObject / deleteObject: para subidas administrativas (no usadas en
 *     este v3, dejadas como contrato abierto).
 */

export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
}

export interface ListObjectsResult {
  objects: StorageObject[];
  /** Token para la siguiente página, si la hay. */
  nextContinuationToken?: string;
  /** Total estimado: S3 no devuelve count exacto sin pagine completo. */
  isTruncated: boolean;
}

export interface ListObjectsInput {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface StoragePort {
  listObjects(input?: ListObjectsInput): Promise<ListObjectsResult>;
  getSignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  putObject(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
}
