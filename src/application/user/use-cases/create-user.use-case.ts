import type {
  UserCommandRepositoryPort,
  UserQueryRepositoryPort,
} from '#domain/user/user.repository.port';
import type { UserPublic } from '#domain/user/user.entity';
import type { CreateUserDto } from '#domain/user/user.dto';
import { CustomError } from '#domain/shared/errors';

/**
 * Caso de uso: crear usuario en BBDD local.
 *
 * Nota IMPORTANTE: este use-case NO crea al usuario en Keycloak. Se invoca
 * desde dos sitios:
 *   1) AuthFacade.register(): primero crea en Keycloak, luego llama aquí.
 *   2) UserFacade.create() (admin only): crea solo en BBDD asumiendo que
 *      ya existe en Keycloak (caso de migración / sync manual).
 *
 * Mantenemos el chequeo previo de email único (decisión del usuario):
 * fallar rápido con 409 antes de pegarle a Mongo. El índice único es la
 * red de seguridad.
 */
export class CreateUserUseCase {
  public constructor(
    private readonly queryRepo: UserQueryRepositoryPort,
    private readonly commandRepo: UserCommandRepositoryPort,
  ) {}

  public async execute(dto: CreateUserDto): Promise<UserPublic> {
    const existing = await this.queryRepo.findByEmail(dto.email);
    if (existing) throw CustomError.conflict('Email already registered');

    const created = await this.commandRepo.create({
      keycloak_id: dto.keycloak_id,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      slug: dto.slug,
      phone: dto.phone,
      picture: dto.picture,
      avatar_url: dto.avatar_url,
      provider: dto.provider,
      roles: dto.roles,
      is_active: true,
      email_verified: true,
    });

    return created;
  }
}
