import type { UserQueryRepositoryPort } from '#domain/user/user.repository.port';
import type { UserPublic } from '#domain/user/user.entity';
import { CustomError } from '#domain/shared/errors';

export class FindUserByIdUseCase {
  public constructor(private readonly queryRepo: UserQueryRepositoryPort) {}

  public async execute(id: string): Promise<UserPublic> {
    const user = await this.queryRepo.findById(id);
    if (!user) throw CustomError.notFound(`User with id ${id} not found`);
    return user;
  }
}
