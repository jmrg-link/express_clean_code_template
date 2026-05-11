import type {
  UserQueryRepositoryPort,
  UserListFilter,
} from '#domain/user/user.repository.port';
import type { UserPublic } from '#domain/user/user.entity';
import type { ListUserDto } from '#domain/user/user.dto';
import type { PaginatedResult } from '#domain/shared/paginator/pagination.dto';

export class ListUsersUseCase {
  public constructor(private readonly queryRepo: UserQueryRepositoryPort) {}

  public async execute(dto: ListUserDto): Promise<PaginatedResult<UserPublic>> {
    const { page, limit, sort, order, ...rawFilter } = dto;

    const filter: UserListFilter = {};
    if (rawFilter.email) filter.email = rawFilter.email;
    if (rawFilter.firstName) filter.firstName = rawFilter.firstName;
    if (rawFilter.is_active !== undefined) filter.is_active = rawFilter.is_active;
    if (rawFilter.roles) filter.roles = rawFilter.roles;

    return this.queryRepo.findPaginated({ page, limit, sort, order }, filter);
  }
}
