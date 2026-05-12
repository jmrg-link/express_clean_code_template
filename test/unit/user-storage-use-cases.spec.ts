import { describe, it, expect, beforeEach } from 'vitest';
import { RequestUploadUrlUseCase } from '#application/user-storage/use-cases/request-upload-url.use-case';
import { ListUserFilesUseCase } from '#application/user-storage/use-cases/list-user-files.use-case';
import { GetDownloadUrlUseCase } from '#application/user-storage/use-cases/get-download-url.use-case';
import { DeleteUserFileUseCase } from '#application/user-storage/use-cases/delete-user-file.use-case';
import { FakeStorageAdapter } from '../helpers/fake-storage.adapter.js';

describe('RequestUploadUrlUseCase', () => {
  let storage: FakeStorageAdapter;
  let useCase: RequestUploadUrlUseCase;

  beforeEach(() => {
    storage = new FakeStorageAdapter();
    useCase = new RequestUploadUrlUseCase(storage);
  });

  it('issues upload URL with composed key and ISO expiresAt', async () => {
    const t0 = Date.now();
    const result = await useCase.execute({
      userSlug: 'alice',
      category: 'avatars',
      originalFilename: 'foto.png',
      contentType: 'image/png',
      expiresInSeconds: 600,
    });
    expect(result.key).toMatch(/^users\/alice\/avatars\/foto-[a-z0-9]{6}\.png$/);
    expect(result.uploadUrl).toContain('fake://upload/');
    expect(result.uploadUrl).toContain('type=image%2Fpng');
    const expiresMs = Date.parse(result.expiresAt);
    expect(expiresMs).toBeGreaterThanOrEqual(t0 + 600 * 1000 - 100);
    expect(expiresMs).toBeLessThanOrEqual(t0 + 600 * 1000 + 5000);
  });

  it('rejects MIME not in allowlist for avatars', async () => {
    await expect(
      useCase.execute({
        userSlug: 'alice',
        category: 'avatars',
        originalFilename: 'doc.pdf',
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow(/not allowed/i);
  });

  it('accepts any MIME for attachments (allowlist=null)', async () => {
    const result = await useCase.execute({
      userSlug: 'alice',
      category: 'attachments',
      originalFilename: 'data.bin',
      contentType: 'application/octet-stream',
    });
    expect(result.key).toMatch(/^users\/alice\/attachments\//);
  });

  it('rejects unknown category at Zod boundary', async () => {
    await expect(
      useCase.execute({
        userSlug: 'alice',
        category: 'unknown' as never,
        originalFilename: 'x.png',
        contentType: 'image/png',
      }),
    ).rejects.toThrow();
  });
});

describe('ListUserFilesUseCase', () => {
  let storage: FakeStorageAdapter;
  let useCase: ListUserFilesUseCase;

  beforeEach(() => {
    storage = new FakeStorageAdapter();
    useCase = new ListUserFilesUseCase(storage);
  });

  it('lists only own user files (prefix isolation)', async () => {
    await storage.putObject('users/alice/avatars/a1.png', Buffer.from('a'));
    await storage.putObject('users/alice/documents/d1.pdf', Buffer.from('b'));
    await storage.putObject('users/bob/avatars/b1.png', Buffer.from('c'));
    const result = await useCase.execute({ userSlug: 'alice' });
    expect(result.objects).toHaveLength(2);
    expect(result.objects.every((o) => o.key.startsWith('users/alice/'))).toBe(true);
  });

  it('filters by category', async () => {
    await storage.putObject('users/alice/avatars/a.png', Buffer.from('a'));
    await storage.putObject('users/alice/documents/d.pdf', Buffer.from('b'));
    const result = await useCase.execute({ userSlug: 'alice', category: 'avatars' });
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]!.key).toMatch(/avatars/);
  });

  it('prevents slug prefix collision (john vs johnny)', async () => {
    await storage.putObject('users/john/avatars/x.png', Buffer.from('a'));
    await storage.putObject('users/johnny/avatars/x.png', Buffer.from('b'));
    const result = await useCase.execute({ userSlug: 'john' });
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]!.key.startsWith('users/john/')).toBe(true);
    expect(result.objects[0]!.key.startsWith('users/johnny/')).toBe(false);
  });
});

describe('GetDownloadUrlUseCase', () => {
  let storage: FakeStorageAdapter;
  let useCase: GetDownloadUrlUseCase;

  beforeEach(() => {
    storage = new FakeStorageAdapter();
    useCase = new GetDownloadUrlUseCase(storage);
  });

  it('issues signed URL for own key', async () => {
    const result = await useCase.execute({
      userSlug: 'alice',
      key: 'users/alice/avatars/x.png',
    });
    expect(result.url).toContain('fake://signed/');
    expect(result.expiresIn).toBe(900);
  });

  it('rejects cross-user key with 403', async () => {
    await expect(
      useCase.execute({
        userSlug: 'alice',
        key: 'users/bob/avatars/x.png',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects unsafe key (path traversal)', async () => {
    await expect(
      useCase.execute({
        userSlug: 'alice',
        key: 'users/alice/../../etc/passwd',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects slug prefix collision (john for johnny key)', async () => {
    await expect(
      useCase.execute({
        userSlug: 'john',
        key: 'users/johnny/avatars/x.png',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('DeleteUserFileUseCase', () => {
  let storage: FakeStorageAdapter;
  let useCase: DeleteUserFileUseCase;

  beforeEach(() => {
    storage = new FakeStorageAdapter();
    useCase = new DeleteUserFileUseCase(storage);
  });

  it('deletes own key', async () => {
    await storage.putObject('users/alice/avatars/x.png', Buffer.from('a'));
    await useCase.execute({ userSlug: 'alice', key: 'users/alice/avatars/x.png' });
    expect(storage.size()).toBe(0);
  });

  it('is idempotent (no error if key absent)', async () => {
    await expect(
      useCase.execute({ userSlug: 'alice', key: 'users/alice/avatars/missing.png' }),
    ).resolves.toBeUndefined();
  });

  it('rejects cross-user delete with 403', async () => {
    await storage.putObject('users/bob/avatars/x.png', Buffer.from('a'));
    await expect(
      useCase.execute({ userSlug: 'alice', key: 'users/bob/avatars/x.png' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(storage.size()).toBe(1);
  });
});
