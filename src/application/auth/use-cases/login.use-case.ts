import type { IamPort } from '#domain/auth/iam.port';
import type {
  UserCommandRepositoryPort,
  UserQueryRepositoryPort,
} from '#domain/user/user.repository.port';
import type { LoginDto } from '#domain/auth/auth.dto';
import type { AuthSession } from '#domain/auth/auth.entity';
import type { UserRole } from '#domain/user/user.entity';
import { USER_ROLES } from '#domain/user/user.entity';
import type { AdminEmailPattern } from '#domain/auth/admin-email-policy';
import { matchesAdminPattern } from '#domain/auth/admin-email-policy';
import { CustomError } from '#domain/shared/errors';
import type { EventBusPort } from '#domain/shared/events/event-bus.port';
import type { LoggerPort } from '#domain/shared/logger/logger.port';
import { UserEvents } from '#domain/shared/events/user.events';
import { Slugger } from '#domain/shared/slug/slugger';

/**
 * Login con auto-sync de usuario local y publicación de eventos de audit.
 *
 * @remarks
 * Flujo (en orden):
 * 1. Solicita tokens al IAM con la contraseña del usuario.
 * 2. **Verifica** la firma y expiración del `access_token` contra el JWKS
 *    público (no se confía ciegamente en el token recibido del IAM).
 * 3. Si el `keycloak_id` no existe en la base de datos local, crea el usuario
 *    a partir de los claims: provider `password`, `is_active`, roles válidos.
 * 4. Publica `user.logged_in` para que `AuditLoginObserver` lo persista.
 * 5. Si el login al IAM falla, publica `user.login_failed` antes de propagar
 *    el error original.
 *
 * El parámetro `meta` (`ip`, `userAgent`) viaja desde el `Request` hasta el
 * audit log para forensia.
 */

export interface LoginExecutionMeta {
  ip?: string;
  userAgent?: string;
}

export class LoginUseCase {
  public constructor(
    private readonly iam: IamPort,
    private readonly userQuery: UserQueryRepositoryPort,
    private readonly userCommand: UserCommandRepositoryPort,
    private readonly eventBus: EventBusPort,
    private readonly adminEmailPatterns: ReadonlyArray<AdminEmailPattern>,
    private readonly logger: LoggerPort,
  ) {}

  public async execute(dto: LoginDto, meta: LoginExecutionMeta = {}): Promise<AuthSession> {
    let tokens;
    try {
      tokens = await this.iam.login(dto.email, dto.password);
    } catch (err) {
      await this.eventBus.publish(
        UserEvents.loginFailed({
          email: dto.email,
          reason: (err as Error).message,
          ip: meta.ip,
          userAgent: meta.userAgent,
        }),
      );
      throw err;
    }

    const claims = await this.iam.verifyToken(tokens.access_token);
    if (!claims.id) throw CustomError.unauthorized('Invalid token: missing subject');

    let user = await this.userQuery.findByKeycloakId(claims.id);
    if (!user) {
      const validRoles = this.filterValidRoles(claims.roles);
      const rawName = claims.name || dto.email.split('@')[0] || '';
      const { firstName, lastName } = LoginUseCase.splitFullNameByLastSpace(rawName);
      const safeFirstName = firstName || (dto.email.split('@')[0] ?? 'user');
      user = await this.userCommand.create({
        keycloak_id: claims.id,
        email: claims.email || dto.email,
        firstName: safeFirstName,
        lastName,
        slug: Slugger.withRandomSuffix(`${safeFirstName} ${lastName}`.trim() || dto.email),
        provider: 'password',
        roles: validRoles.length > 0 ? validRoles : ['buyer'],
        is_active: true,
        email_verified: true,
      });
    }

    this.warnIfAdminPolicyDrift(claims.email || user.email, claims.roles);

    await this.eventBus.publish(
      UserEvents.loggedIn({
        keycloakId: claims.id,
        userId: user.id,
        email: user.email,
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );

    return { tokens, user };
  }

  /**
   * Detecta drift entre la política admin local y los roles emitidos por
   * Keycloak. NO escala privilegios: solo loggea. KC sigue siendo la única
   * fuente de verdad de roles.
   *
   * @param email - Email autenticado tomado del claim (fallback al user local).
   * @param kcRoles - Roles del claim `realm_access.roles`.
   */
  private warnIfAdminPolicyDrift(email: string, kcRoles: string[]): void {
    if (!matchesAdminPattern(email, this.adminEmailPatterns)) return;
    if (kcRoles.includes('admin')) return;
    this.logger.warn('Admin policy drift detected', { email, kcRoles });
  }

  private filterValidRoles(claimRoles: string[]): UserRole[] {
    const valid = new Set<string>(USER_ROLES);
    return claimRoles.filter((r): r is UserRole => valid.has(r));
  }

  /**
   * Divide un nombre completo en `firstName` + `lastName` por el ÚLTIMO espacio.
   *
   * @param full - Cadena fuente (claim `name` del JWT o local-part del email).
   * @returns Tupla con ambos campos; `lastName` vacío si la entrada es una
   *   sola palabra o cadena vacía. Misma regla que el script de migración
   *   para mantener consistencia entre auto-sync y backfill.
   *
   * @remarks
   * Best-effort: locales con doble apellido (es. "Juan Pérez García") quedan
   * como `firstName: "Juan Pérez"`, `lastName: "García"`. Editable post hoc.
   */
  private static splitFullNameByLastSpace(full: string): { firstName: string; lastName: string } {
    const trimmed = full.trim();
    if (!trimmed) return { firstName: '', lastName: '' };
    const idx = trimmed.lastIndexOf(' ');
    if (idx < 0) return { firstName: trimmed, lastName: '' };
    return { firstName: trimmed.slice(0, idx).trim(), lastName: trimmed.slice(idx + 1).trim() };
  }
}
