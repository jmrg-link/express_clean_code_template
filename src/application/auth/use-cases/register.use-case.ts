import type { IamPort } from '#domain/auth/iam.port';
import type { UserCommandRepositoryPort, UserQueryRepositoryPort } from '#domain/user/user.repository.port';
import type { RegisterDto } from '#domain/auth/auth.dto';
import type { AuthSession } from '#domain/auth/auth.entity';
import type { EventBusPort } from '#domain/shared/events/event-bus.port';
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
 * Tras crear, publicamos `user.registered` (Observer puede enviar email
 * de bienvenida, métricas, etc.) y hacemos login para devolver tokens.
 */
export class RegisterUseCase {
  public constructor(
    private readonly iam: IamPort,
    private readonly userQuery: UserQueryRepositoryPort,
    private readonly userCommand: UserCommandRepositoryPort,
    private readonly eventBus: EventBusPort,
  ) {}

  public async execute(dto: RegisterDto): Promise<AuthSession> {
    const existing = await this.userQuery.findByEmail(dto.email);
    if (existing) throw CustomError.conflict('Email already registered');

    const keycloakId = await this.iam.registerUser({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      phone: dto.phone,
    });
    await this.iam.assignRoles(keycloakId, ['buyer']);

    const user = await this.userCommand.create({
      keycloak_id: keycloakId,
      email: dto.email,
      name: dto.name,
      slug: Slugger.withRandomSuffix(dto.name),
      phone: dto.phone,
      provider: 'password',
      roles: ['buyer'],
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
}
