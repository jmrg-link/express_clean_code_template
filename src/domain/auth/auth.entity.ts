import type { UserPublic } from '../user/user.entity.js';

/**
 * Tokens emitidos por Keycloak. Mismos nombres que devuelve el endpoint
 * /token de Keycloak para no transformar dos veces.
 */
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Lo que el cliente recibe tras login/register. */
export interface AuthSession {
  tokens: AuthTokens;
  user: UserPublic;
}

/**
 * Claims que extraemos del JWT verificado.
 * Coinciden con lo que pone Keycloak en `realm_access.roles`, `sub`, `email`...
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
}
