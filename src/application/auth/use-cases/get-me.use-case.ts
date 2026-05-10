import type { UserQueryRepositoryPort } from '#domain/user/user.repository.port';
import type { UserPublic } from '#domain/user/user.entity';
import { CustomError } from '#domain/shared/errors';

/**
 * Devuelve el perfil del usuario autenticado (extraído por el middleware JWT).
 *
 * Consume `keycloak_id` (sub del JWT) — NUNCA `_id` de Mongo. Esto evita que
 * un attacker que conozca un ObjectId pueda forzar otro perfil.
 */
export class GetMeUseCase {
  public constructor(private readonly userQuery: UserQueryRepositoryPort) {}

  public async execute(keycloakId: string): Promise<UserPublic> {
    const user = await this.userQuery.findByKeycloakId(keycloakId);
    if (!user) throw CustomError.notFound('User not found');
    return user;
  }
}
