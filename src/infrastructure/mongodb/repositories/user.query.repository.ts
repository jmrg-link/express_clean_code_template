import type {
  UserListFilter,
  UserQueryRepositoryPort,
} from '#domain/user/user.repository.port';
import type { UserEntity } from '#domain/user/user.entity';
import type {
  PaginatedResult,
  PaginationQuery,
} from '#domain/shared/paginator/pagination.dto';
import { Paginator } from '#domain/shared/paginator/paginator';
import { UserModel, type UserDocument } from '../schemas/user.schema.js';

/**
 * Adapter Mongoose para el lado Query (lectura).
 *
 * `toEntity` lo absorbe `toJSON.transform` del schema, así que aquí solo
 * casteamos. El populate / select se queda en este adapter porque es
 * detalle de Mongo — el dominio no debe saberlo.
 */
export class UserQueryRepository implements UserQueryRepositoryPort {
  public async findById(id: string): Promise<UserEntity | null> {
    const doc = await UserModel.findById(id);
    return doc ? UserQueryRepository.toEntity(doc) : null;
  }

  public async findByEmail(email: string): Promise<UserEntity | null> {
    const doc = await UserModel.findByEmail(email);
    return doc ? UserQueryRepository.toEntity(doc) : null;
  }

  public async findByKeycloakId(keycloakId: string): Promise<UserEntity | null> {
    const doc = await UserModel.findByKeycloakId(keycloakId);
    return doc ? UserQueryRepository.toEntity(doc) : null;
  }

  public async findBySlug(slug: string): Promise<UserEntity | null> {
    const doc = await UserModel.findBySlug(slug);
    return doc ? UserQueryRepository.toEntity(doc) : null;
  }

  public async findPaginated(
    query: PaginationQuery,
    filter: UserListFilter = {},
  ): Promise<PaginatedResult<UserEntity>> {
    const mongoFilter: Record<string, unknown> = {};
    if (filter.email)
      mongoFilter.email = { $regex: UserQueryRepository.escapeRegex(filter.email), $options: 'i' };
    if (filter.name)
      mongoFilter.name = { $regex: UserQueryRepository.escapeRegex(filter.name), $options: 'i' };
    if (filter.is_active !== undefined) mongoFilter.is_active = filter.is_active;
    if (filter.roles) mongoFilter.roles = filter.roles;

    const skip = Paginator.skip(query);
    const sortField = query.sort ?? 'createdAt';
    const sortSpec: Record<string, 1 | -1> = { [sortField]: query.order === 'asc' ? 1 : -1 };

    const [docs, total] = await Promise.all([
      UserModel.find(mongoFilter).sort(sortSpec).skip(skip).limit(query.limit),
      UserModel.countDocuments(mongoFilter),
    ]);

    const items = docs.map(UserQueryRepository.toEntity);
    return Paginator.build(items, total, query);
  }

  /** doc → entity. El transform de Mongoose hace casi todo el trabajo. */
  private static toEntity(doc: UserDocument): UserEntity {
    const json = doc.toJSON() as unknown as UserEntity;
    return json;
  }

  /**
   * Escapa metacaracteres de regex para uso seguro en filtros `$regex` de
   * Mongoose, evitando ReDoS y regex injection.
   *
   * @param input - Texto libre proveniente del cliente (ej. filtro admin de
   * `email` o `name`).
   * @returns El mismo texto con los metacaracteres reservados precedidos por
   * backslash, listo para concatenarse en una expresión regular.
   */
  private static escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
