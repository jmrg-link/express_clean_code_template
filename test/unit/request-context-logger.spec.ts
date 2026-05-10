import { describe, it, expect, vi } from 'vitest';
import { RequestContextLoggerDecorator } from '#infrastructure/logger/request-context.decorator';
import type { LoggerPort, LogMeta } from '#domain/shared/logger/logger.port';

function makeFakeLogger() {
  const calls: { level: string; message: string; meta?: LogMeta }[] = [];
  const inner: LoggerPort = {
    debug: (m, meta) => calls.push({ level: 'debug', message: m, meta }),
    info: (m, meta) => calls.push({ level: 'info', message: m, meta }),
    warn: (m, meta) => calls.push({ level: 'warn', message: m, meta }),
    error: (m, meta) => calls.push({ level: 'error', message: m, meta }),
    child: vi.fn() as LoggerPort['child'],
  };
  return { inner, calls };
}

describe('RequestContextLoggerDecorator', () => {
  it('merges bindings into every log line', () => {
    const { inner, calls } = makeFakeLogger();
    const dec = new RequestContextLoggerDecorator(inner, { requestId: 'rid-1', userId: 'u-9' });

    dec.info('hello', { extra: 1 });

    expect(calls[0]?.meta).toEqual({ requestId: 'rid-1', userId: 'u-9', extra: 1 });
  });

  it('child merges new bindings on top', () => {
    const { inner, calls } = makeFakeLogger();
    const dec = new RequestContextLoggerDecorator(inner, { requestId: 'rid-1' });
    const child = dec.child({ feature: 'auth' });

    child.warn('something');

    expect(calls[0]).toMatchObject({
      level: 'warn',
      message: 'something',
      meta: { requestId: 'rid-1', feature: 'auth' },
    });
  });
});
