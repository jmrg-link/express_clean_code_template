import type { DomainEvent } from './event-bus.port.js';

/**
 * Eventos del dominio relacionados con autenticación y usuarios.
 *
 * Cada evento es plano (DTO), no lleva métodos. Los handlers reaccionan
 * persistiendo audit logs, enviando emails, invalidando cache, etc.
 */

export interface UserLoggedInEvent extends DomainEvent {
  readonly type: 'user.logged_in';
  readonly keycloakId: string;
  readonly email: string;
  readonly userId: string;
  readonly ip?: string;
  readonly userAgent?: string;
}

export interface UserLoginFailedEvent extends DomainEvent {
  readonly type: 'user.login_failed';
  readonly email: string;
  readonly reason: string;
  readonly ip?: string;
  readonly userAgent?: string;
}

export interface UserRegisteredEvent extends DomainEvent {
  readonly type: 'user.registered';
  readonly userId: string;
  readonly keycloakId: string;
  readonly email: string;
}

export const UserEvents = {
  loggedIn(data: Omit<UserLoggedInEvent, 'type' | 'occurredAt'>): UserLoggedInEvent {
    return { type: 'user.logged_in', occurredAt: new Date(), ...data };
  },
  loginFailed(data: Omit<UserLoginFailedEvent, 'type' | 'occurredAt'>): UserLoginFailedEvent {
    return { type: 'user.login_failed', occurredAt: new Date(), ...data };
  },
  registered(data: Omit<UserRegisteredEvent, 'type' | 'occurredAt'>): UserRegisteredEvent {
    return { type: 'user.registered', occurredAt: new Date(), ...data };
  },
};
