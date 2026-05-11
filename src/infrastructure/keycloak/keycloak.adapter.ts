import {
  createRemoteJWKSet,
  jwtVerify,
  decodeJwt,
  type JWTPayload,
  type JSONWebKeySet,
} from 'jose';
import { env } from '#config/env';
import type {
  IamPort,
  IamRegisterInput,
} from '#domain/auth/iam.port';
import type { AuthTokens, AuthenticatedUser } from '#domain/auth/auth.entity';
import type { LoggerPort } from '#domain/shared/logger/logger.port';
import { CustomError } from '#domain/shared/errors';

/**
 * Adapter Keycloak. Implementa IamPort.
 *
 * Verificación de tokens:
 *   - Por defecto: RS256 contra el JWKS del realm.
 *   - Fallback HS256 si hay JWT_SECRET (solo para tests donde Keycloak
 *     no está corriendo). Mismo patrón que cuimo.
 *
 * Llamadas admin:
 *   - registerUser y assignRoles requieren un access token de service-account
 *     (client_credentials grant). Lo cacheamos brevemente para no pegar a
 *     `/token` en cada request administrativa.
 */

interface KeycloakTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in?: number;
  token_type?: string;
}

interface KeycloakRealmRole {
  id: string;
  name: string;
}

export class KeycloakAdapter implements IamPort {
  private readonly tokenUrl: string;
  private readonly adminBaseUrl: string;
  private readonly internalIssuer: string;
  private readonly acceptedIssuers: readonly string[];
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly logger?: LoggerPort;

  /** Cache simple del admin token (service account). TTL = expires_in - 30s. */
  private adminTokenCache: { token: string; expiresAt: number } | null = null;

  public constructor(logger?: LoggerPort) {
    this.logger = logger;
    this.tokenUrl = `${env.keycloak.url}/realms/${env.keycloak.realm}/protocol/openid-connect/token`;
    this.adminBaseUrl = `${env.keycloak.url}/admin/realms/${env.keycloak.realm}`;
    this.internalIssuer = `${env.keycloak.url}/realms/${env.keycloak.realm}`;

    const jwksUrl = `${this.internalIssuer}/protocol/openid-connect/certs`;
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));

    this.acceptedIssuers = env.keycloak.publicIssuer
      ? [this.internalIssuer, env.keycloak.publicIssuer]
      : [this.internalIssuer];
  }

  /* ============================================================
   * Tokens
   * ============================================================ */

  public async login(email: string, password: string): Promise<AuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: env.keycloak.clientId,
      client_secret: env.keycloak.clientSecret ?? '',
      username: email,
      password,
    });

    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error_description?: string };
      throw CustomError.unauthorized(errBody.error_description ?? 'Invalid credentials');
    }

    const data = (await res.json()) as KeycloakTokenResponse;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    };
  }

  public async refresh(refreshToken: string): Promise<AuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.keycloak.clientId,
      client_secret: env.keycloak.clientSecret ?? '',
      refresh_token: refreshToken,
    });

    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) throw CustomError.unauthorized('Invalid or expired refresh token');

    const data = (await res.json()) as KeycloakTokenResponse;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    };
  }

  public async verifyToken(token: string): Promise<AuthenticatedUser> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.acceptedIssuers as string[],
      });
      return KeycloakAdapter.extractClaims(payload);
    } catch (rs256Err) {
      if (!env.jwt.secret) throw CustomError.unauthorized('Invalid or expired token');
      this.logger?.debug(
        `RS256 verify failed, trying HS256 fallback: ${(rs256Err as Error).message}`,
      );
      try {
        const secret = new TextEncoder().encode(env.jwt.secret);
        const { payload } = await jwtVerify(token, secret);
        return KeycloakAdapter.extractClaims(payload);
      } catch {
        throw CustomError.unauthorized('Invalid or expired token');
      }
    }
  }

  public decodeToken(token: string): AuthenticatedUser {
    try {
      const payload = decodeJwt(token);
      return KeycloakAdapter.extractClaims(payload);
    } catch {
      throw CustomError.unauthorized('Invalid token format');
    }
  }

  public async registerUser(input: IamRegisterInput): Promise<string> {
    const adminToken = await this.getAdminToken();

    const res = await fetch(`${this.adminBaseUrl}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        username: input.email,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        enabled: true,
        emailVerified: true,
        credentials: [{ type: 'password', value: input.password, temporary: false }],
        ...(input.phone && { attributes: { phone: [input.phone] } }),
      }),
    });

    if (res.status === 409) throw CustomError.conflict('User already exists in IAM');
    if (!res.ok) {
      const text = await res.text();
      this.logger?.error(`Failed to create Keycloak user: ${text}`);
      throw CustomError.badGateway('Failed to create user in IAM');
    }

    const location = res.headers.get('location');
    if (!location) throw CustomError.badGateway('IAM did not return user location');
    const userId = location.split('/').pop();
    if (!userId) throw CustomError.badGateway('Could not parse IAM user id');
    return userId;
  }

  public async assignRoles(userId: string, roleNames: string[]): Promise<void> {
    if (roleNames.length === 0) return;
    const adminToken = await this.getAdminToken();

    const roles: KeycloakRealmRole[] = [];
    for (const roleName of roleNames) {
      const res = await fetch(`${this.adminBaseUrl}/roles/${roleName}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) roles.push((await res.json()) as KeycloakRealmRole);
      else this.logger?.warn(`Role '${roleName}' not found in realm`);
    }

    if (roles.length === 0) return;

    const assignRes = await fetch(`${this.adminBaseUrl}/users/${userId}/role-mappings/realm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(roles),
    });

    if (!assignRes.ok) {
      const text = await assignRes.text();
      this.logger?.error(`Failed to assign roles: ${text}`);
      throw CustomError.badGateway('Failed to assign roles in IAM');
    }
  }

  public async removeRoles(userId: string, roleNames: string[]): Promise<void> {
    if (roleNames.length === 0) return;
    const adminToken = await this.getAdminToken();

    const roles: KeycloakRealmRole[] = [];
    for (const roleName of roleNames) {
      const res = await fetch(`${this.adminBaseUrl}/roles/${roleName}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) roles.push((await res.json()) as KeycloakRealmRole);
      else this.logger?.warn(`Role '${roleName}' not found in realm`);
    }

    if (roles.length === 0) return;

    const removeRes = await fetch(`${this.adminBaseUrl}/users/${userId}/role-mappings/realm`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(roles),
    });

    if (removeRes.status === 404) {
      this.logger?.debug(`Role mappings already absent for user ${userId}`);
      return;
    }
    if (!removeRes.ok) {
      const text = await removeRes.text();
      this.logger?.error(`Failed to remove roles: ${text}`);
      throw CustomError.badGateway('Failed to remove roles in IAM');
    }
  }

  private async getAdminToken(): Promise<string> {
    const now = Date.now();
    if (this.adminTokenCache && this.adminTokenCache.expiresAt > now) {
      return this.adminTokenCache.token;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.keycloak.clientId,
      client_secret: env.keycloak.clientSecret ?? '',
    });

    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger?.error(`Failed to get admin token: ${text}`);
      throw CustomError.badGateway('Failed to obtain service-account token');
    }

    const data = (await res.json()) as KeycloakTokenResponse;
    this.adminTokenCache = {
      token: data.access_token,
      expiresAt: now + (data.expires_in - 30) * 1000,
    };
    return data.access_token;
  }

  private static extractClaims(payload: JWTPayload): AuthenticatedUser {
    const realmAccess = payload['realm_access'] as { roles?: string[] } | undefined;
    return {
      id: String(payload.sub ?? ''),
      email: String(payload['email'] ?? ''),
      name: String(payload['name'] ?? payload['preferred_username'] ?? ''),
      roles: realmAccess?.roles ?? [],
    };
  }

  public static withCustomJwks(_jwks: JSONWebKeySet): never {
    throw new Error('Use real JWKS in runtime; mock IamPort in tests');
  }
}
