import { describe, it, expect, vi } from 'vitest';
import { InMemoryEventBus } from '#infrastructure/events/in-memory-event-bus';
import type { LoggerPort } from '#domain/shared/logger/logger.port';
import type { DomainEvent } from '#domain/shared/events/event-bus.port';

const noopLogger: LoggerPort = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => noopLogger,
};

interface PingEvent extends DomainEvent {
  type: 'ping';
  message: string;
}

describe('InMemoryEventBus', () => {
  it('delivers events to all subscribed handlers', async () => {
    const bus = new InMemoryEventBus(noopLogger);
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe<PingEvent>('ping', a);
    bus.subscribe<PingEvent>('ping', b);

    await bus.publish<PingEvent>({ type: 'ping', message: 'hi', occurredAt: new Date() });

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('does not stop other handlers if one rejects', async () => {
    const bus = new InMemoryEventBus(noopLogger);
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    const ok = vi.fn();
    bus.subscribe<PingEvent>('ping', failing);
    bus.subscribe<PingEvent>('ping', ok);

    await bus.publish<PingEvent>({ type: 'ping', message: 'x', occurredAt: new Date() });

    expect(failing).toHaveBeenCalled();
    expect(ok).toHaveBeenCalled();
    expect(noopLogger.error).toHaveBeenCalled();
  });

  it('publish without subscribers is a no-op', async () => {
    const bus = new InMemoryEventBus(noopLogger);
    await expect(
      bus.publish<PingEvent>({ type: 'ping', message: '', occurredAt: new Date() }),
    ).resolves.toBeUndefined();
  });
});
