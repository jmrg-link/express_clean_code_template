import { describe, it, expect, beforeEach } from 'vitest';
import { GetSignedUrlUseCase } from '#application/storage/use-cases/get-signed-url.use-case';
import { ClientError } from '#domain/shared/errors';
import { FakeStorageAdapter } from '../helpers/fake-storage.adapter.js';

describe('GetSignedUrlUseCase', () => {
  let storage: FakeStorageAdapter;
  let useCase: GetSignedUrlUseCase;

  beforeEach(() => {
    storage = new FakeStorageAdapter();
    useCase = new GetSignedUrlUseCase(storage);
  });

  describe('guard de path-traversal', () => {
    it.each([
      'foo/../bar.txt',
      '../etc/passwd',
      'docs/..//secret.pdf',
      '..',
      'files/../../escape',
    ])('rechaza key con ".."  (%s)', async (malicious) => {
      let error: unknown;
      try {
        await useCase.execute(malicious);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(ClientError);
      expect((error as ClientError).statusCode).toBe(400);
      expect((error as ClientError).message).toMatch(/Invalid object key/i);
    });

    it('rechaza key vacia', async () => {
      let error: unknown;
      try {
        await useCase.execute('');
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(ClientError);
      expect((error as ClientError).statusCode).toBe(400);
    });
  });

  describe('happy path', () => {
    it('devuelve URL firmada con expiracion por defecto (900 s)', async () => {
      const result = await useCase.execute('uploads/photo.jpg');
      expect(result.expiresIn).toBe(900);
      expect(result.url).toContain('uploads%2Fphoto.jpg');
      expect(result.url).toContain('expires=900');
    });

    it('respeta expiracion custom', async () => {
      const result = await useCase.execute('reports/q1.pdf', 60);
      expect(result.expiresIn).toBe(60);
      expect(result.url).toContain('expires=60');
    });

    it('codifica caracteres especiales en la key', async () => {
      const result = await useCase.execute('users/john doe/cv.pdf');
      expect(result.url).toContain('users%2Fjohn%20doe%2Fcv.pdf');
    });
  });
});
