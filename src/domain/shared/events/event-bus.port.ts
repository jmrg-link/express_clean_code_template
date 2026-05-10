/**
 * Patrón Observer (comportamiento).
 *
 * Diseño:
 *   - `DomainEvent`: interfaz base. Cada evento concreto extiende.
 *   - `EventHandler<T>`: lo que ejecuta cuando un evento de tipo T llega.
 *   - `EventBusPort`: el puerto. La impl concreta vive en infrastructure.
 *
 * Este Observer es ligero (síncrono in-process). Si mañana hace falta
 * persistencia/durabilidad/multi-instancia, sustituyes el adapter por uno
 * que use Redis Streams, BullMQ, NATS o Kafka — sin tocar publishers ni
 * handlers.
 */

export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}

export type EventHandler<T extends DomainEvent> = (event: T) => Promise<void> | void;

export interface EventBusPort {
  publish<T extends DomainEvent>(event: T): Promise<void>;
  subscribe<T extends DomainEvent>(eventType: T['type'], handler: EventHandler<T>): void;
}
