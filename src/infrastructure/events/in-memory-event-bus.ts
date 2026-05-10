import type {
  DomainEvent,
  EventBusPort,
  EventHandler,
} from '#domain/shared/events/event-bus.port';
import type { LoggerPort } from '#domain/shared/logger/logger.port';

/**
 * Adapter in-memory del EventBus.
 *
 * Implementación síncrona pero asíncrona-friendly (handlers pueden devolver
 * promesas). Los errores en handlers NO interrumpen la publicación: se loguean
 * y los demás handlers siguen ejecutándose. Esto es importante porque el
 * publisher (ej. LoginUseCase) NO debería caer porque un handler de auditoría
 * tenga un bug.
 *
 * Patrón: Observer/Mediator sencillo.
 */
export class InMemoryEventBus implements EventBusPort {
  private handlers = new Map<string, EventHandler<DomainEvent>[]>();

  public constructor(private readonly logger: LoggerPort) {}

  public subscribe<T extends DomainEvent>(eventType: T['type'], handler: EventHandler<T>): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler as EventHandler<DomainEvent>);
    this.handlers.set(eventType, list);
  }

  public async publish<T extends DomainEvent>(event: T): Promise<void> {
    const list = this.handlers.get(event.type);
    if (!list || list.length === 0) return;

    const results = await Promise.allSettled(list.map((h) => h(event)));
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.error('Event handler failed', {
          eventType: event.type,
          error: (r.reason as Error)?.message ?? String(r.reason),
        });
      }
    }
  }
}
