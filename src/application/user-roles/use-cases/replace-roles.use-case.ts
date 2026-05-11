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
 * Reemplazo idempotente del set completo de roles.
 *
 * @remarks
 * Calcula `toAdd` y `toRemove` por diferencia de conjuntos contra el estado
 * actual en Mongo. KC se sincroniza primero (assign + remove); luego Mongo se
 * actualiza con el set final. Emite `user.role_changed` con los snapshots
 * `before`/`after` y el `actorId` del admin que provocó la mutación.
 *
 * Self-demotion: si el actor está editando su propio doc Y el set resultante
 * no contiene `admin` mientras el actual sí — se bloquea con 400.
 */
export class ReplaceRolesUseCase {
  public constructor(
    private readonly iam: IamPort,
    private readonly queryRepo: UserQueryRepositoryPort,
    private readonly commandRepo: UserCommandRepositoryPort,
    private readonly eventBus: EventBusPort,
  ) {}

  /**
   * @param id - Mongo `_id` del usuario destino.
   * @param roles - Set completo objetivo (no parcial). Idempotente.
   * @param actorKeycloakId - `req.user.id` (sub del JWT del admin).
   * @throws {CustomError} 404 si no existe; 400 en self-demotion; 502 si KC falla.
   */
  public async execute(
    id: string,
    roles: UserRole[],
    actorKeycloakId: string,
  ): Promise<{ roles: UserRole[] }> {
    const user = await this.queryRepo.findById(id);
    if (!user) throw CustomError.notFound('User not found');

    const before: UserRole[] = [...user.roles];
    const after: UserRole[] = Array.from(new Set(roles));

    if (
      actorKeycloakId === user.keycloak_id &&
      before.includes('admin') &&
      !after.includes('admin')
    ) {
      throw CustomError.badRequest('Cannot self-demote admin');
    }

    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    const toAdd = after.filter((r) => !beforeSet.has(r));
    const toRemove = before.filter((r) => !afterSet.has(r));

    if (toAdd.length > 0) await this.iam.assignRoles(user.keycloak_id, toAdd);
    if (toRemove.length > 0) await this.iam.removeRoles(user.keycloak_id, toRemove);

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

    return { roles: [...updated.roles] };
  }
}
