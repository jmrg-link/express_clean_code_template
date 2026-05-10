import type {
  UserCommandRepositoryPort,
  UserCreateInput,
  UserUpdateInput,
} from '#domain/user/user.repository.port';
import type { UserEntity } from '#domain/user/user.entity';
import { UserModel, type UserDocument } from '../schemas/user.schema.js';

/**
 * Adapter Mongoose para el lado Command (escritura).
 *
 * `update` usa `runValidators: true` para que las reglas del schema
 * (enum de roles, formato de email) se apliquen también en updates.
 *
 * `softDelete` marca is_active=false y devuelve la entidad actualizada
 * para que el caller pueda mostrarla.
 */
export class UserCommandRepository implements UserCommandRepositoryPort {
  public async create(data: UserCreateInput): Promise<UserEntity> {
    const doc = await UserModel.create(data);
    return UserCommandRepository.toEntity(doc);
  }

  public async update(id: string, data: UserUpdateInput): Promise<UserEntity | null> {
    const doc = await UserModel.findByIdAndUpdate(id, data, {
      returnDocument: 'after',
      runValidators: true,
    });
    return doc ? UserCommandRepository.toEntity(doc) : null;
  }

  public async softDelete(id: string): Promise<UserEntity | null> {
    const doc = await UserModel.findByIdAndUpdate(
      id,
      { is_active: false },
      { returnDocument: 'after' },
    );
    return doc ? UserCommandRepository.toEntity(doc) : null;
  }

  public async recordLoginSuccess(keycloakId: string): Promise<void> {
    await UserModel.updateOne(
      { keycloak_id: keycloakId },
      { $set: { last_login_at: new Date(), failed_login_attempts: 0 } },
    );
  }

  public async recordLoginFailure(keycloakId: string): Promise<void> {
    await UserModel.updateOne(
      { keycloak_id: keycloakId },
      { $inc: { failed_login_attempts: 1 } },
    );
  }

  private static toEntity(doc: UserDocument): UserEntity {
    return doc.toJSON() as unknown as UserEntity;
  }
}
