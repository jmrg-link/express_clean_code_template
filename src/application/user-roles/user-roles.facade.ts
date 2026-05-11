import type { IamPort } from '#domain/auth/iam.port';
import type {
  UserCommandRepositoryPort,
  UserQueryRepositoryPort,
} from '#domain/user/user.repository.port';
import type { UserRole } from '#domain/user/user.entity';
import type { EventBusPort } from '#domain/shared/events/event-bus.port';

import { GetRolesUseCase } from './use-cases/get-roles.use-case.js';
import { ReplaceRolesUseCase } from './use-cases/replace-roles.use-case.js';
import { AddRoleUseCase } from './use-cases/add-role.use-case.js';
import { RemoveRoleUseCase } from './use-cases/remove-role.use-case.js';

/**
 * Facade del subsistema RBAC.
 *
 * @remarks
 * Compone los cuatro use-cases del CRUD de roles y expone una API plana al
 * controller. Mismo patrón que `UserFacade` y `AuthFacade`: sin lógica de
 * negocio, solo delegación. Tests del controller mockean ESTA clase.
 */
export class UserRolesFacade {
  private readonly getUC: GetRolesUseCase;
  private readonly replaceUC: ReplaceRolesUseCase;
  private readonly addUC: AddRoleUseCase;
  private readonly removeUC: RemoveRoleUseCase;

  public constructor(
    iam: IamPort,
    queryRepo: UserQueryRepositoryPort,
    commandRepo: UserCommandRepositoryPort,
    eventBus: EventBusPort,
  ) {
    this.getUC = new GetRolesUseCase(queryRepo);
    this.replaceUC = new ReplaceRolesUseCase(iam, queryRepo, commandRepo, eventBus);
    this.addUC = new AddRoleUseCase(iam, queryRepo, commandRepo, eventBus);
    this.removeUC = new RemoveRoleUseCase(iam, queryRepo, commandRepo, eventBus);
  }

  public get(id: string): Promise<{ roles: UserRole[] }> {
    return this.getUC.execute(id);
  }

  public replace(
    id: string,
    roles: UserRole[],
    actorKeycloakId: string,
  ): Promise<{ roles: UserRole[] }> {
    return this.replaceUC.execute(id, roles, actorKeycloakId);
  }

  public add(id: string, role: UserRole, actorKeycloakId: string): Promise<void> {
    return this.addUC.execute(id, role, actorKeycloakId);
  }

  public remove(id: string, role: UserRole, actorKeycloakId: string): Promise<void> {
    return this.removeUC.execute(id, role, actorKeycloakId);
  }
}
