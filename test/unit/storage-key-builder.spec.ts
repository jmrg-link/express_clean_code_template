import { describe, it, expect } from 'vitest';
import {
  StorageKeyBuilder,
  extractExt,
  randomSuffix6,
} from '#domain/shared/storage/storage-key.builder';

const KEY_REGEX = /^users\/[a-z0-9-]+\/(avatars|documents|attachments)\/[a-z0-9-]+-[a-z0-9]{6}(\.[a-z0-9]+)?$/;

describe('StorageKeyBuilder.build', () => {
  it('produces key matching the canonical shape', () => {
    const key = StorageKeyBuilder.build({
      userSlug: 'john-doe',
      category: 'avatars',
      originalFilename: 'foto.png',
    });
    expect(key).toMatch(KEY_REGEX);
    expect(key.startsWith('users/john-doe/avatars/')).toBe(true);
    expect(key.endsWith('.png')).toBe(true);
  });

  it('slugifies unicode and uppercase to ASCII lowercase', () => {
    const key = StorageKeyBuilder.build({
      userSlug: 'john-doe',
      category: 'documents',
      originalFilename: 'Mí Documento ÑOÑO.PDF',
    });
    expect(key).toMatch(KEY_REGEX);
    expect(key).toMatch(/\/mi-documento-nono-[a-z0-9]{6}\.pdf$/);
  });

  it('handles filenames with multiple dots (uses last extension)', () => {
    const key = StorageKeyBuilder.build({
      userSlug: 'alice',
      category: 'attachments',
      originalFilename: 'archive.tar.gz',
    });
    expect(key).toMatch(/-[a-z0-9]{6}\.gz$/);
  });

  it('handles no-extension filenames', () => {
    const key = StorageKeyBuilder.build({
      userSlug: 'alice',
      category: 'attachments',
      originalFilename: 'README',
    });
    expect(key).toMatch(/^users\/alice\/attachments\/readme-[a-z0-9]{6}$/);
  });

  it('strips path traversal via Slugger', () => {
    const key = StorageKeyBuilder.build({
      userSlug: 'alice',
      category: 'attachments',
      originalFilename: '../../etc/passwd.png',
    });
    expect(key).not.toContain('..');
    expect(key).not.toContain('/etc/');
    expect(key).toMatch(KEY_REGEX);
  });

  it('throws Zod error for unknown category', () => {
    expect(() =>
      StorageKeyBuilder.build({
        userSlug: 'alice',
        category: 'unknown' as never,
        originalFilename: 'x.png',
      }),
    ).toThrow();
  });
});

describe('extractExt', () => {
  it('returns lowercase ext without dot', () => {
    expect(extractExt('Foto.PNG')).toBe('png');
  });

  it('returns empty for dotfiles', () => {
    expect(extractExt('.env')).toBe('');
  });

  it('returns empty for files without dot', () => {
    expect(extractExt('README')).toBe('');
  });

  it('returns only last extension', () => {
    expect(extractExt('archive.tar.gz')).toBe('gz');
  });

  it('strips non-alphanumeric chars in ext', () => {
    expect(extractExt('file.p-n!g')).toBe('png');
  });
});

describe('randomSuffix6', () => {
  it('returns exactly 6 alphanumeric lowercase chars', () => {
    for (let i = 0; i < 100; i++) {
      const s = randomSuffix6();
      expect(s).toMatch(/^[a-z0-9]{6}$/);
      expect(s).toHaveLength(6);
    }
  });
});
