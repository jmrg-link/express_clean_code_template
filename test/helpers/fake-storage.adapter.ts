import type {
  ListObjectsInput,
  ListObjectsResult,
  StorageObject,
  StoragePort,
} from '#domain/shared/storage/storage.port';

interface StoredEntry {
  body: Buffer;
  contentType?: string;
  lastModified: Date;
}

/**
 * Adapter fake en memoria que implementa `StoragePort` para tests unit /
 * integration sin tocar S3 ni LocalStack.
 *
 * @remarks
 * - Las URLs firmadas son sintéticas (`fake://signed/<key>?expires=<n>`) y
 *   **no** se descargan; los tests sólo verifican forma, expiración y que el
 *   adapter recibe la key tal como llega.
 * - `listObjects` soporta filtro por `prefix` y paginación con
 *   `continuationToken` (cursor sobre las claves ordenadas).
 * - `clear()` resetea el almacén entre tests.
 */
export class FakeStorageAdapter implements StoragePort {
  private readonly entries = new Map<string, StoredEntry>();

  public async putObject(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<void> {
    this.entries.set(key, {
      body: Buffer.from(body),
      contentType,
      lastModified: new Date(),
    });
  }

  public async deleteObject(key: string): Promise<void> {
    this.entries.delete(key);
  }

  public async getSignedDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return `fake://signed/${encodeURIComponent(key)}?expires=${expiresInSeconds}`;
  }

  public async getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = 900,
  ): Promise<string> {
    return `fake://upload/${encodeURIComponent(key)}?type=${encodeURIComponent(contentType)}&expires=${expiresInSeconds}`;
  }

  public async listObjects(input: ListObjectsInput = {}): Promise<ListObjectsResult> {
    const { prefix = '', maxKeys = 1000, continuationToken } = input;
    const keys = [...this.entries.keys()].filter((k) => k.startsWith(prefix)).sort();

    const startIndex = continuationToken ? Number(continuationToken) : 0;
    const slice = keys.slice(startIndex, startIndex + maxKeys);
    const isTruncated = startIndex + slice.length < keys.length;

    const objects: StorageObject[] = slice.map((key) => {
      const entry = this.entries.get(key)!;
      return {
        key,
        size: entry.body.byteLength,
        lastModified: entry.lastModified,
        etag: `"${entry.body.byteLength.toString(16)}"`,
      };
    });

    return {
      objects,
      isTruncated,
      nextContinuationToken: isTruncated ? String(startIndex + slice.length) : undefined,
    };
  }

  public clear(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }
}
