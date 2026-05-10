import type { UserCommandRepositoryPort } from '#domain/user/user.repository.port';
import type { UserPublic } from '#domain/user/user.entity';
import type { UpdateUserDto } from '#domain/user/user.dto';
import { CustomError } from '#domain/shared/errors';

export class UpdateUserUseCase {
  public constructor(private readonly commandRepo: UserCommandRepositoryPort) {}

  public async execute(id: string, dto: UpdateUserDto): Promise<UserPublic> {
    const updated = await this.commandRepo.update(id, dto);
    if (!updated) throw CustomError.notFound(`User with id ${id} not found`);
    return updated;
  }
}
