/**
 * Puerto de almacenamiento de objetos (blob storage).
 *
 * No es "puerto S3" — es "puerto storage". Mañana cambias S3 por GCS o
 * Azure Blob y solo cambia el adapter en infrastructure.
 *
 * Operaciones cubiertas:
 *   - listObjects: para admin/dashboards.
 *   - getSignedDownloadUrl: presigned GET para que el cliente descargue.
 *   - getSignedUploadUrl: presigned PUT para uploads directos cliente→storage
 *     (la API no proxa bytes; mejor para archivos grandes y para escalabilidad).
 *   - putObject / deleteObject: subidas y borrados desde el servidor.
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
  /**
   * Genera una URL presigned para `PUT` directo del cliente al storage.
   *
   * @param key - Key destino (debe ser construida por `StorageKeyBuilder`).
   * @param contentType - MIME que el cliente declarará en el `Content-Type`
   *   header del PUT. Tiene que coincidir exactamente con el firmado para
   *   que S3 acepte el upload.
   * @param expiresInSeconds - TTL del URL firmado. Default 900 (15 min).
   */
  getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds?: number,
  ): Promise<string>;
  putObject(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
}
