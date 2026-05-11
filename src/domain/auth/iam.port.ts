import type { AuthTokens, AuthenticatedUser } from './auth.entity.js';

/**
 * Puerto para el Identity & Access Management (IAM).
 *
 * El application/ depende de esta abstracción, NO de Keycloak directamente.
 * Esto significa que migrar a Auth0 / Cognito / Firebase Auth = escribir un
 * nuevo adapter, sin tocar use-cases.
 *
 * `verifyToken` y `decodeToken` están separados a propósito:
 *  - `verifyToken` valida firma y expiración (lo usa el middleware).
 *  - `decodeToken` solo decodifica el payload sin firmar (auto-sync tras login).
 */
export interface IamRegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface IamPort {
  /** Login con resource owner password grant. */
  login(email: string, password: string): Promise<AuthTokens>;

  /** Refresh del access token usando refresh_token. */
  refresh(refreshToken: string): Promise<AuthTokens>;

  /** Crea el usuario en el IAM y devuelve su id (sub). */
  registerUser(input: IamRegisterInput): Promise<string>;

  /** Asigna roles al usuario en el IAM. */
  assignRoles(userId: string, roles: string[]): Promise<void>;

  /**
   * Quita roles asignados al usuario en el IAM.
   *
   * @remarks
   * Idempotente: si el usuario no tiene asignado alguno de los roles
   * solicitados, el adapter debe ignorarlo silenciosamente. Se usa desde
   * `ReplaceRolesUseCase` (diff) y `RemoveRoleUseCase`.
   */
  removeRoles(userId: string, roles: string[]): Promise<void>;

  /** Verifica firma + expiración. Usado por middleware de auth. */
  verifyToken(token: string): Promise<AuthenticatedUser>;

  /** Decode sin verificar firma. Solo para extraer claims tras un login válido. */
  decodeToken(token: string): AuthenticatedUser;
}
