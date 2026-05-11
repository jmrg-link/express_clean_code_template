/**
 * Contrato puro del dominio User. Sin dependencias de Mongoose ni Express.
 *
 * `keycloak_id` es el sub del JWT y es el ancla de identidad — NO el _id de Mongo.
 * Esto permite que un mismo usuario sobreviva a una migración de BBDD.
 *
 * Campos nuevos en v3:
 *   - `slug`: identificador URL-friendly único (ej. para perfil público).
 *   - `last_login_at`: tracking de actividad.
 *   - `failed_login_attempts`: contador de intentos fallidos (defensa).
 *   - `avatar_url`: clave del objeto en S3 (no URL completa, se firma al servir).
 */
export const USER_ROLES = ['buyer', 'seller', 'operator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_PROVIDERS = ['password', 'google'] as const;
export type UserProvider = (typeof USER_PROVIDERS)[number];

export interface UserEntity {
  id: string;
  keycloak_id: string;
  email: string;
  firstName: string;
  lastName: string;
  slug: string;
  phone?: string;
  picture?: string;
  avatar_url?: string;
  email_verified: boolean;
  provider: UserProvider;
  roles: UserRole[];
  is_active: boolean;
  last_login_at?: Date;
  failed_login_attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Vista pública. */
export type UserPublic = UserEntity;
