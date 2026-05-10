import type { UserCommandRepositoryPort } from '#domain/user/user.repository.port';
import type { UserPublic } from '#domain/user/user.entity';
import { CustomError } from '#domain/shared/errors';

/**
 * Soft-delete: marca is_active=false en lugar de borrar.
 * Preserva auditoría e integridad referencial con transacciones futuras.
 */
export class DeleteUserUseCase {
  public constructor(private readonly commandRepo: UserCommandRepositoryPort) {}

  public async execute(id: string): Promise<UserPublic> {
    const deactivated = await this.commandRepo.softDelete(id);
    if (!deactivated) throw CustomError.notFound(`User with id ${id} not found`);
    return deactivated;
  }
}
