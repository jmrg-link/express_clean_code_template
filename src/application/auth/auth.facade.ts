import type { IamPort } from '#domain/auth/iam.port';
import type {
  UserCommandRepositoryPort,
  UserQueryRepositoryPort,
} from '#domain/user/user.repository.port';
import type { LoginDto, RegisterDto, RefreshDto } from '#domain/auth/auth.dto';
import type { AuthSession, AuthTokens } from '#domain/auth/auth.entity';
import type { UserPublic } from '#domain/user/user.entity';
import type { EventBusPort } from '#domain/shared/events/event-bus.port';
import type { LoggerPort } from '#domain/shared/logger/logger.port';
import type { AdminEmailPattern } from '#domain/auth/admin-email-policy';

import { LoginUseCase, type LoginExecutionMeta } from './use-cases/login.use-case.js';
import { RegisterUseCase } from './use-cases/register.use-case.js';
import { RefreshTokenUseCase } from './use-cases/refresh-token.use-case.js';
import { GetMeUseCase } from './use-cases/get-me.use-case.js';

/**
 * Facade del subsistema Auth.
 *
 * Recibe en el constructor todas las dependencias (IAM port + user repos +
 * event bus), compone los use-cases y expone una API plana al controller.
 */
export class AuthFacade {
  private readonly loginUC: LoginUseCase;
  private readonly registerUC: RegisterUseCase;
  private readonly refreshUC: RefreshTokenUseCase;
  private readonly meUC: GetMeUseCase;

  public constructor(
    iam: IamPort,
    userQuery: UserQueryRepositoryPort,
    userCommand: UserCommandRepositoryPort,
    eventBus: EventBusPort,
    adminEmailPatterns: ReadonlyArray<AdminEmailPattern>,
    logger: LoggerPort,
  ) {
    this.loginUC = new LoginUseCase(
      iam,
      userQuery,
      userCommand,
      eventBus,
      adminEmailPatterns,
      logger,
    );
    this.registerUC = new RegisterUseCase(
      iam,
      userQuery,
      userCommand,
      eventBus,
      adminEmailPatterns,
    );
    this.refreshUC = new RefreshTokenUseCase(iam);
    this.meUC = new GetMeUseCase(userQuery);
  }

  public login(dto: LoginDto, meta?: LoginExecutionMeta): Promise<AuthSession> {
    return this.loginUC.execute(dto, meta);
  }

  public register(dto: RegisterDto): Promise<AuthSession> {
    return this.registerUC.execute(dto);
  }

  public refresh(dto: RefreshDto): Promise<AuthTokens> {
    return this.refreshUC.execute(dto);
  }

  public me(keycloakId: string): Promise<UserPublic> {
    return this.meUC.execute(keycloakId);
  }
}
