import { describe, it, expect, beforeEach } from 'vitest';
import { ListStorageObjectsUseCase } from '#application/storage/use-cases/list-storage-objects.use-case';
import { FakeStorageAdapter } from '../helpers/fake-storage.adapter.js';

describe('ListStorageObjectsUseCase', () => {
  let storage: FakeStorageAdapter;
  let useCase: ListStorageObjectsUseCase;

  beforeEach(async () => {
    storage = new FakeStorageAdapter();
    useCase = new ListStorageObjectsUseCase(storage);
    await storage.putObject('docs/a.txt', Buffer.from('A'));
    await storage.putObject('docs/b.txt', Buffer.from('BB'));
    await storage.putObject('images/cat.png', Buffer.from('xxx'));
    await storage.putObject('images/dog.png', Buffer.from('yyyy'));
  });

  it('lista todos los objetos cuando no hay filtros', async () => {
    const result = await useCase.execute();
    expect(result.isTruncated).toBe(false);
    expect(result.objects).toHaveLength(4);
    expect(result.objects.map((o) => o.key).sort()).toEqual([
      'docs/a.txt',
      'docs/b.txt',
      'images/cat.png',
      'images/dog.png',
    ]);
  });

  it('filtra por prefix', async () => {
    const result = await useCase.execute({ prefix: 'docs/' });
    expect(result.objects).toHaveLength(2);
    expect(result.objects.every((o) => o.key.startsWith('docs/'))).toBe(true);
  });

  it('expone tamaño y etag por objeto', async () => {
    const result = await useCase.execute({ prefix: 'docs/' });
    const a = result.objects.find((o) => o.key === 'docs/a.txt')!;
    expect(a.size).toBe(1);
    expect(a.etag).toBe('"1"');
    expect(a.lastModified).toBeInstanceOf(Date);
  });

  it('pagina con maxKeys + continuationToken', async () => {
    const page1 = await useCase.execute({ maxKeys: 2 });
    expect(page1.objects).toHaveLength(2);
    expect(page1.isTruncated).toBe(true);
    expect(page1.nextContinuationToken).toBeDefined();

    const page2 = await useCase.execute({
      maxKeys: 2,
      continuationToken: page1.nextContinuationToken,
    });
    expect(page2.objects).toHaveLength(2);
    expect(page2.isTruncated).toBe(false);
    expect(page2.nextContinuationToken).toBeUndefined();

    const allKeys = [...page1.objects, ...page2.objects].map((o) => o.key).sort();
    expect(allKeys).toEqual(['docs/a.txt', 'docs/b.txt', 'images/cat.png', 'images/dog.png']);
  });

  it('devuelve lista vacia si el prefix no matchea nada', async () => {
    const result = await useCase.execute({ prefix: 'videos/' });
    expect(result.objects).toEqual([]);
    expect(result.isTruncated).toBe(false);
  });
});
