import type { EventBusPort } from '#domain/shared/events/event-bus.port';
import type { LoginAuditLogRepositoryPort } from '#domain/audit/login-audit.entity';
import type { UserCommandRepositoryPort } from '#domain/user/user.repository.port';
import type { LoggerPort } from '#domain/shared/logger/logger.port';
import type {
  UserLoggedInEvent,
  UserLoginFailedEvent,
} from '#domain/shared/events/user.events';

/**
 * Observer que persiste audit logs y actualiza metadata de login en User.
 *
 * Patrón Observer (comportamiento): el LoginUseCase NO sabe que esto existe.
 * Solo publica eventos. Si mañana añadimos un EmailNotifier para alertar al
 * user de logins desde IPs nuevas, suscribimos otro handler — el publisher
 * sigue intacto.
 *
 * Doble efecto en cada evento:
 *   - Persistir línea en `LoginAuditLog`.
 *   - Actualizar `User.last_login_at` / `failed_login_attempts`.
 *
 * Si cualquiera de los dos falla, el EventBus loguea pero NO interrumpe la
 * cadena del login (el usuario ya tiene sus tokens).
 */
export class AuditLoginObserver {
  public constructor(
    private readonly auditRepo: LoginAuditLogRepositoryPort,
    private readonly userCommandRepo: UserCommandRepositoryPort,
    private readonly logger: LoggerPort,
  ) {}

  public register(eventBus: EventBusPort): void {
    eventBus.subscribe<UserLoggedInEvent>('user.logged_in', (event) => this.onLoggedIn(event));
    eventBus.subscribe<UserLoginFailedEvent>('user.login_failed', (event) =>
      this.onLoginFailed(event),
    );
    this.logger.info('AuditLoginObserver registered for login events');
  }

  private async onLoggedIn(event: UserLoggedInEvent): Promise<void> {
    await Promise.all([
      this.auditRepo.create({
        email: event.email,
        keycloak_id: event.keycloakId,
        user_id: event.userId,
        success: true,
        ip: event.ip,
        user_agent: event.userAgent,
        occurred_at: event.occurredAt,
      }),
      this.userCommandRepo.recordLoginSuccess(event.keycloakId),
    ]);
  }

  private async onLoginFailed(event: UserLoginFailedEvent): Promise<void> {
    await this.auditRepo.create({
      email: event.email,
      success: false,
      reason: event.reason,
      ip: event.ip,
      user_agent: event.userAgent,
      occurred_at: event.occurredAt,
    });
  }
}
