import type {
  StoragePort,
  ListObjectsInput,
  ListObjectsResult,
} from '#domain/shared/storage/storage.port';

/**
 * Caso de uso: listar objetos del bucket configurado.
 *
 * El use-case NO sabe que es S3. Recibe `StoragePort` por DI.
 * Si mañana queremos enriquecer (filtrar por extensión, sumar tamaños,
 * generar URL firmada para cada objeto), aquí es donde entra esa lógica
 * sin tocar el adapter.
 */
export class ListStorageObjectsUseCase {
  public constructor(private readonly storage: StoragePort) {}

  public execute(input: ListObjectsInput = {}): Promise<ListObjectsResult> {
    return this.storage.listObjects(input);
  }
}
