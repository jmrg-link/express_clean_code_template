import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { ErrorLogger } from '#presentation/bootstrap/error-handler/error-logger';
import { ClientError, ServerError } from '#domain/shared/errors';
import type { LoggerPort, LogMeta } from '#domain/shared/logger/logger.port';

interface LoggerSpy {
  port: LoggerPort;
  calls: { level: string; message: string; meta?: LogMeta }[];
}

function makeLoggerSpy(): LoggerSpy {
  const calls: LoggerSpy['calls'] = [];
  const port: LoggerPort = {
    debug: (m, meta) => calls.push({ level: 'debug', message: m, meta }),
    info: (m, meta) => calls.push({ level: 'info', message: m, meta }),
    warn: (m, meta) => calls.push({ level: 'warn', message: m, meta }),
    error: (m, meta) => calls.push({ level: 'error', message: m, meta }),
    child: () => port,
  };
  return { port, calls };
}

function makeReq(opts: { withReqLogger?: boolean } = {}): {
  req: Request;
  reqLogger?: LoggerSpy;
} {
  const reqLogger = opts.withReqLogger ? makeLoggerSpy() : undefined;
  const req = {
    path: '/api/v1/auth/login',
    method: 'POST',
    logger: reqLogger?.port,
  } as unknown as Request;
  return { req, reqLogger };
}

describe('ErrorLogger', () => {
  describe('uses req.logger when present (correlation enabled)', () => {
    it('client() routes to req.logger and includes statusCode + path', () => {
      const base = makeLoggerSpy();
      const { req, reqLogger } = makeReq({ withReqLogger: true });
      new ErrorLogger(base.port).client(new ClientError(401, 'unauth'), req);

      expect(base.calls).toHaveLength(0);
      expect(reqLogger?.calls).toHaveLength(1);
      expect(reqLogger?.calls[0]).toMatchObject({
        level: 'warn',
        meta: { statusCode: 401, path: '/api/v1/auth/login' },
      });
    });

    it('server() routes to req.logger and includes stack', () => {
      const base = makeLoggerSpy();
      const { req, reqLogger } = makeReq({ withReqLogger: true });
      const err = new ServerError(503, 'down');
      new ErrorLogger(base.port).server(err, req);

      expect(base.calls).toHaveLength(0);
      expect(reqLogger?.calls[0]?.level).toBe('error');
      expect(reqLogger?.calls[0]?.meta).toMatchObject({
        statusCode: 503,
        path: '/api/v1/auth/login',
      });
    });

    it('validation() emits statusCode 400 + fields meta on req.logger', () => {
      const base = makeLoggerSpy();
      const { req, reqLogger } = makeReq({ withReqLogger: true });
      const fields = [{ field: 'email', message: 'Invalid' }];
      new ErrorLogger(base.port).validation(req, fields);

      expect(base.calls).toHaveLength(0);
      expect(reqLogger?.calls[0]?.meta).toMatchObject({
        statusCode: 400,
        path: '/api/v1/auth/login',
        fields,
      });
    });

    it('mongo() maps DUPLICATE 11000 to statusCode 409', () => {
      const base = makeLoggerSpy();
      const { req, reqLogger } = makeReq({ withReqLogger: true });
      new ErrorLogger(base.port).mongo(req, 'DUPLICATE 11000', 'field=email');

      expect(reqLogger?.calls[0]?.meta).toMatchObject({
        statusCode: 409,
        kind: 'DUPLICATE 11000',
        path: '/api/v1/auth/login',
      });
    });

    it('mongo() maps other kinds to statusCode 400', () => {
      const base = makeLoggerSpy();
      const { req, reqLogger } = makeReq({ withReqLogger: true });
      new ErrorLogger(base.port).mongo(req, 'CAST', 'Invalid id');

      expect(reqLogger?.calls[0]?.meta).toMatchObject({
        statusCode: 400,
        kind: 'CAST',
      });
    });

    it('unhandled() emits statusCode 500 + stack on req.logger', () => {
      const base = makeLoggerSpy();
      const { req, reqLogger } = makeReq({ withReqLogger: true });
      const err = new Error('boom');
      new ErrorLogger(base.port).unhandled(req, err);

      expect(reqLogger?.calls[0]?.level).toBe('error');
      expect(reqLogger?.calls[0]?.meta).toMatchObject({
        statusCode: 500,
        path: '/api/v1/auth/login',
      });
      expect((reqLogger?.calls[0]?.meta as { stack?: string })?.stack).toContain('boom');
    });
  });

  describe('falls back to base logger when req.logger is undefined', () => {
    const cases: { name: string; act: (e: ErrorLogger, req: Request) => void }[] = [
      { name: 'client',     act: (e, r) => e.client(new ClientError(401, 'unauth'), r) },
      { name: 'server',     act: (e, r) => e.server(new ServerError(503, 'down'), r) },
      { name: 'validation', act: (e, r) => e.validation(r, []) },
      { name: 'mongo',      act: (e, r) => e.mongo(r, 'CAST', 'msg') },
      { name: 'unhandled',  act: (e, r) => e.unhandled(r, new Error('boom')) },
    ];

    it.each(cases)('does not crash and routes to base logger: $name', ({ act }) => {
      const base = makeLoggerSpy();
      const { req } = makeReq({ withReqLogger: false });
      expect(() => act(new ErrorLogger(base.port), req)).not.toThrow();
      expect(base.calls).toHaveLength(1);
      expect(base.calls[0]?.meta).toMatchObject({ path: '/api/v1/auth/login' });
    });
  });
});
