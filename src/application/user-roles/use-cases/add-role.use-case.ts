import type { IamPort } from '#domain/auth/iam.port';
import type {
  UserCommandRepositoryPort,
  UserQueryRepositoryPort,
} from '#domain/user/user.repository.port';
import type { UserRole } from '#domain/user/user.entity';
import type { EventBusPort } from '#domain/shared/events/event-bus.port';
import { CustomError } from '#domain/shared/errors';
import { UserEvents } from '#domain/shared/events/user.events';

/**
 * Añade un rol concreto a un usuario. Idempotente: si ya lo tiene,
 * no llama a KC ni emite evento.
 */
export class AddRoleUseCase {
  public constructor(
    private readonly iam: IamPort,
    private readonly queryRepo: UserQueryRepositoryPort,
    private readonly commandRepo: UserCommandRepositoryPort,
    private readonly eventBus: EventBusPort,
  ) {}

  /**
   * @param id - Mongo `_id` del usuario destino.
   * @param role - Rol a añadir (Zod-restringido a `USER_ROLES`).
   * @param actorKeycloakId - `req.user.id` (sub del JWT del admin).
   * @throws {CustomError} 404 si no existe; 502 si KC falla.
   */
  public async execute(
    id: string,
    role: UserRole,
    actorKeycloakId: string,
  ): Promise<void> {
    const user = await this.queryRepo.findById(id);
    if (!user) throw CustomError.notFound('User not found');

    const before: UserRole[] = [...user.roles];
    if (before.includes(role)) return;

    const after: UserRole[] = [...before, role];

    await this.iam.assignRoles(user.keycloak_id, [role]);

    const updated = await this.commandRepo.update(id, { roles: after });
    if (!updated) throw CustomError.notFound('User not found');

    await this.eventBus.publish(
      UserEvents.roleChanged({
        userId: updated.id,
        keycloakId: user.keycloak_id,
        before,
        after,
        actorId: actorKeycloakId,
      }),
    );
  }
}
