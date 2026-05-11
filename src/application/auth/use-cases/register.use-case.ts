import type { IamPort } from '#domain/auth/iam.port';
import type { UserCommandRepositoryPort, UserQueryRepositoryPort } from '#domain/user/user.repository.port';
import type { RegisterDto } from '#domain/auth/auth.dto';
import type { AuthSession } from '#domain/auth/auth.entity';
import type { UserRole } from '#domain/user/user.entity';
import type { EventBusPort } from '#domain/shared/events/event-bus.port';
import type { AdminEmailPattern } from '#domain/auth/admin-email-policy';
import { matchesAdminPattern } from '#domain/auth/admin-email-policy';
import { CustomError } from '#domain/shared/errors';
import { UserEvents } from '#domain/shared/events/user.events';
import { Slugger } from '#domain/shared/slug/slugger';

/**
 * Registro dual: crea en Keycloak (IAM) y luego en BBDD local.
 *
 * Estrategia consciente:
 *   - PRIMERO Keycloak. Si falla (409 duplicado), no tocamos Mongo.
 *   - LUEGO Mongo. Si falla aquí, tenemos un usuario huérfano en Keycloak.
 *     En un sistema con outbox/saga compensaríamos. Para esta escala,
 *     loggeamos y delegamos a un job de reconciliación nocturno.
 *
 * Los roles iniciales se resuelven contra la política `matchesAdminPattern`:
 * si el email cumple alguno de los patrones admin de `adminEmailPatterns`,
 * el usuario nace con `['admin']`; en cualquier otro caso con `['buyer']`.
 *
 * Tras crear, publicamos `user.registered` (Observer puede enviar email
 * de bienvenida, métricas, etc.) y hacemos login para devolver tokens.
 */
export class RegisterUseCase {
  public constructor(
    private readonly iam: IamPort,
    private readonly userQuery: UserQueryRepositoryPort,
    private readonly userCommand: UserCommandRepositoryPort,
    private readonly eventBus: EventBusPort,
    private readonly adminEmailPatterns: ReadonlyArray<AdminEmailPattern>,
  ) {}

  public async execute(dto: RegisterDto): Promise<AuthSession> {
    const existing = await this.userQuery.findByEmail(dto.email);
    if (existing) throw CustomError.conflict('Email already registered');

    const roles = this.resolveInitialRoles(dto.email);

    const keycloakId = await this.iam.registerUser({
      email: dto.email,
      password: dto.password,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
    });
    await this.iam.assignRoles(keycloakId, roles);

    const user = await this.userCommand.create({
      keycloak_id: keycloakId,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      slug: Slugger.withRandomSuffix(`${dto.firstName} ${dto.lastName}`),
      phone: dto.phone,
      provider: 'password',
      roles,
      is_active: true,
      email_verified: true,
    });

    await this.eventBus.publish(
      UserEvents.registered({
        userId: user.id,
        keycloakId,
        email: dto.email,
      }),
    );

    const tokens = await this.iam.login(dto.email, dto.password);
    return { tokens, user };
  }

  /**
   * Calcula los roles iniciales del usuario aplicando la política admin.
   *
   * @param email - Email a evaluar contra `adminEmailPatterns`.
   * @returns `['admin']` si el email cumple algún patrón; `['buyer']` en
   *   caso contrario.
   */
  private resolveInitialRoles(email: string): UserRole[] {
    return matchesAdminPattern(email, this.adminEmailPatterns) ? ['admin'] : ['buyer'];
  }
}
