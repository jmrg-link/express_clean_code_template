import type { UserEntity, UserRole, UserProvider } from './user.entity.js';
import type {
  PaginationQuery,
  PaginatedResult,
} from '../shared/paginator/pagination.dto.js';

/**
 * Filtros disponibles en la lista de usuarios. Es el contrato que el
 * service entrega al repositorio: lo que el repo NO sepa hacer, no se pide.
 */
export interface UserListFilter {
  email?: string;
  firstName?: string;
  slug?: string;
  is_active?: boolean;
  roles?: UserRole;
}

export interface UserCreateInput {
  keycloak_id: string;
  email: string;
  firstName: string;
  lastName: string;
  slug: string;
  phone?: string;
  picture?: string;
  avatar_url?: string;
  provider?: UserProvider;
  roles?: UserRole[];
  is_active?: boolean;
  email_verified?: boolean;
}

export interface UserUpdateInput {
  firstName?: string;
  lastName?: string;
  slug?: string;
  phone?: string;
  picture?: string;
  avatar_url?: string;
  roles?: UserRole[];
  email_verified?: boolean;
  is_active?: boolean;
  last_login_at?: Date;
  failed_login_attempts?: number;
}

/**
 * CQRS-lite: el lado lectura.
 * Interface segregation (ISP): un consumidor que solo lee no ve `create/update/delete`.
 * Habilita además decorar con cache (Redis) sin tocar Command.
 */
export interface UserQueryRepositoryPort {
  findById(id: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<UserEntity | null>;
  findByKeycloakId(keycloakId: string): Promise<UserEntity | null>;
  findBySlug(slug: string): Promise<UserEntity | null>;
  findPaginated(
    query: PaginationQuery,
    filter?: UserListFilter,
  ): Promise<PaginatedResult<UserEntity>>;
}

/** CQRS-lite: el lado escritura. */
export interface UserCommandRepositoryPort {
  create(data: UserCreateInput): Promise<UserEntity>;
  update(id: string, data: UserUpdateInput): Promise<UserEntity | null>;
  /** Soft-delete: marca is_active=false en lugar de borrar. */
  softDelete(id: string): Promise<UserEntity | null>;
  /**
   * Update específico de metadata de login (last_login_at, contador).
   * Existe como método dedicado para que el AuditObserver no necesite
   * llamar a `update` genérico (que requiere DTO completo).
   */
  recordLoginSuccess(keycloakId: string): Promise<void>;
  recordLoginFailure(keycloakId: string): Promise<void>;
}
