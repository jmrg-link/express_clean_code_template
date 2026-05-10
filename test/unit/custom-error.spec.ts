import { describe, it, expect } from 'vitest';
import { CustomError, ClientError, ServerError } from '#domain/shared/errors';

describe('CustomError', () => {
  it('badRequest is a ClientError with 400', () => {
    const err = CustomError.badRequest('bad input');
    expect(err).toBeInstanceOf(ClientError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('bad input');
  });

  it('notFound is a ClientError with 404', () => {
    const err = CustomError.notFound();
    expect(err).toBeInstanceOf(ClientError);
    expect(err.statusCode).toBe(404);
  });

  it('conflict carries details', () => {
    const err = CustomError.conflict('email taken', { email: 'x@y.z' });
    expect(err.details).toEqual({ email: 'x@y.z' });
  });

  it('internal is a ServerError with 500', () => {
    const err = CustomError.internal();
    expect(err).toBeInstanceOf(ServerError);
    expect(err.statusCode).toBe(500);
  });

  it('badGateway is a ServerError with 502', () => {
    const err = CustomError.badGateway();
    expect(err).toBeInstanceOf(ServerError);
    expect(err.statusCode).toBe(502);
  });

  it('client and server are sibling branches (not subclasses of each other)', () => {
    const c = CustomError.badRequest('x');
    const s = CustomError.internal();
    expect(c).not.toBeInstanceOf(ServerError);
    expect(s).not.toBeInstanceOf(ClientError);
  });
});
