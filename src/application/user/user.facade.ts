import type {
  UserCommandRepositoryPort,
  UserQueryRepositoryPort,
} from '#domain/user/user.repository.port';
import type { UserPublic } from '#domain/user/user.entity';
import type {
  CreateUserDto,
  UpdateUserDto,
  ListUserDto,
} from '#domain/user/user.dto';
import type { PaginatedResult } from '#domain/shared/paginator/pagination.dto';

import { CreateUserUseCase } from './use-cases/create-user.use-case.js';
import { FindUserByIdUseCase } from './use-cases/find-user-by-id.use-case.js';
import { ListUsersUseCase } from './use-cases/list-users.use-case.js';
import { UpdateUserUseCase } from './use-cases/update-user.use-case.js';
import { DeleteUserUseCase } from './use-cases/delete-user.use-case.js';

/**
 * Facade del subsistema User.
 *
 * Patrón Facade (GoF estructural): expone una interfaz simplificada y única
 * sobre un conjunto de subsistemas (use-cases). Beneficios concretos aquí:
 *
 *  1. Los controllers dependen de UNA dependencia (`userFacade`), no de cinco
 *     use-cases distintos. Cambia el cableado de DI sin tocar presentation.
 *  2. Si en el futuro un endpoint requiere combinar varios use-cases en una
 *     transacción, la composición vive aquí — no en el controller.
 *  3. Tests del controller solo mockean la facade, no cinco objetos.
 *  4. Otras facades pueden invocar a esta (ej. AuthFacade.register llama a
 *     UserFacade.create) sin acoplarse a use-cases internos.
 *
 * NO lleva lógica de negocio: solo delega. Esa es la diferencia con un service.
 */
export class UserFacade {
  private readonly createUC: CreateUserUseCase;
  private readonly findByIdUC: FindUserByIdUseCase;
  private readonly listUC: ListUsersUseCase;
  private readonly updateUC: UpdateUserUseCase;
  private readonly deleteUC: DeleteUserUseCase;

  public constructor(
    queryRepo: UserQueryRepositoryPort,
    commandRepo: UserCommandRepositoryPort,
  ) {
    this.createUC = new CreateUserUseCase(queryRepo, commandRepo);
    this.findByIdUC = new FindUserByIdUseCase(queryRepo);
    this.listUC = new ListUsersUseCase(queryRepo);
    this.updateUC = new UpdateUserUseCase(commandRepo);
    this.deleteUC = new DeleteUserUseCase(commandRepo);
  }

  public create(dto: CreateUserDto): Promise<UserPublic> {
    return this.createUC.execute(dto);
  }

  public findById(id: string): Promise<UserPublic> {
    return this.findByIdUC.execute(id);
  }

  public list(dto: ListUserDto): Promise<PaginatedResult<UserPublic>> {
    return this.listUC.execute(dto);
  }

  public update(id: string, dto: UpdateUserDto): Promise<UserPublic> {
    return this.updateUC.execute(id, dto);
  }

  public softDelete(id: string): Promise<UserPublic> {
    return this.deleteUC.execute(id);
  }
}
