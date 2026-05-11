import type { UserQueryRepositoryPort } from '#domain/user/user.repository.port';
import type { UserRole } from '#domain/user/user.entity';
import { CustomError } from '#domain/shared/errors';

/**
 * Lectura del set efectivo de roles de un usuario por id de Mongo.
 *
 * @remarks
 * Devuelve siempre el set tal como está en Mongo (projection del estado
 * autoritativo de KC). Útil para que el admin compruebe el estado antes de
 * llamar a `PUT`/`POST`/`DELETE`.
 */
export class GetRolesUseCase {
  public constructor(private readonly queryRepo: UserQueryRepositoryPort) {}

  /**
   * @param id - Mongo `_id` del usuario.
   * @throws {CustomError} 404 si el usuario no existe.
   */
  public async execute(id: string): Promise<{ roles: UserRole[] }> {
    const user = await this.queryRepo.findById(id);
    if (!user) throw CustomError.notFound('User not found');
    return { roles: [...user.roles] };
  }
}
