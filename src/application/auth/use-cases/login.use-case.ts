import type { IamPort } from '#domain/auth/iam.port';
import type {
  UserCommandRepositoryPort,
  UserQueryRepositoryPort,
} from '#domain/user/user.repository.port';
import type { LoginDto } from '#domain/auth/auth.dto';
import type { AuthSession } from '#domain/auth/auth.entity';
import type { UserRole } from '#domain/user/user.entity';
import { USER_ROLES } from '#domain/user/user.entity';
import { CustomError } from '#domain/shared/errors';
import type { EventBusPort } from '#domain/shared/events/event-bus.port';
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
      const name = claims.name || dto.email.split('@')[0]!;
      user = await this.userCommand.create({
        keycloak_id: claims.id,
        email: claims.email || dto.email,
        name,
        slug: Slugger.withRandomSuffix(name),
        provider: 'password',
        roles: validRoles.length > 0 ? validRoles : ['buyer'],
        is_active: true,
        email_verified: true,
      });
    }

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

  private filterValidRoles(claimRoles: string[]): UserRole[] {
    const valid = new Set<string>(USER_ROLES);
    return claimRoles.filter((r): r is UserRole => valid.has(r));
  }
}
