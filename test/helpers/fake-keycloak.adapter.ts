import { SignJWT } from 'jose';
import type { IamPort, IamRegisterInput } from '#domain/auth/iam.port';
import type { AuthTokens, AuthenticatedUser } from '#domain/auth/auth.entity';
import { CustomError } from '#domain/shared/errors';

/**
 * Adapter de mentira para tests. Implementa IamPort sin tocar la red.
 *
 * - Mantiene un Map<email, { password, sub, roles }> in-memory.
 * - Firma JWTs HS256 con el JWT_SECRET de test.
 * - El middleware JWT del runtime usa el fallback HS256 cuando RS256 falla,
 *   por lo que estos tokens son aceptados sin necesidad de Keycloak.
 */
export class FakeKeycloakAdapter implements IamPort {
  private readonly users = new Map<
    string,
    { password: string; sub: string; roles: string[]; firstName: string; lastName: string }
  >();
  private subCounter = 1;

  public constructor(private readonly secret: string) {}

  public async login(email: string, password: string): Promise<AuthTokens> {
    const u = this.users.get(email);
    if (!u || u.password !== password) throw CustomError.unauthorized('Invalid credentials');
    return this.issueTokens(u.sub, email, `${u.firstName} ${u.lastName}`.trim(), u.roles);
  }

  public async refresh(_refreshToken: string): Promise<AuthTokens> {
    return this.issueTokens('test-sub', 'test@example.com', 'Test User', ['buyer']);
  }

  public async registerUser(input: IamRegisterInput): Promise<string> {
    if (this.users.has(input.email)) throw CustomError.conflict('User already exists in IAM');
    const sub = `kc-sub-${this.subCounter++}`;
    this.users.set(input.email, {
      password: input.password,
      sub,
      roles: ['buyer'],
      firstName: input.firstName,
      lastName: input.lastName,
    });
    return sub;
  }

  public async assignRoles(userId: string, roles: string[]): Promise<void> {
    for (const u of this.users.values()) {
      if (u.sub === userId) u.roles = Array.from(new Set([...u.roles, ...roles]));
    }
  }

  public async removeRoles(userId: string, roles: string[]): Promise<void> {
    const toRemove = new Set(roles);
    for (const u of this.users.values()) {
      if (u.sub === userId) u.roles = u.roles.filter((r) => !toRemove.has(r));
    }
  }

  public async verifyToken(token: string): Promise<AuthenticatedUser> {
    const { jwtVerify } = await import('jose');
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(this.secret));
      return {
        id: String(payload.sub),
        email: String(payload['email'] ?? ''),
        name: String(payload['name'] ?? ''),
        roles: ((payload['realm_access'] as { roles?: string[] } | undefined)?.roles ?? []),
      };
    } catch {
      throw CustomError.unauthorized('Invalid or expired token');
    }
  }

  public decodeToken(token: string): AuthenticatedUser {
    const [, payload] = token.split('.');
    if (!payload) throw CustomError.unauthorized();
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return {
      id: String(decoded.sub),
      email: String(decoded.email ?? ''),
      name: String(decoded.name ?? ''),
      roles: decoded.realm_access?.roles ?? [],
    };
  }

  public seed(
    email: string,
    password: string,
    roles: string[] = ['buyer'],
    firstName = 'Test',
    lastName = 'User',
  ): string {
    const sub = `kc-sub-${this.subCounter++}`;
    this.users.set(email, { password, sub, roles, firstName, lastName });
    return sub;
  }

  private async issueTokens(
    sub: string,
    email: string,
    name: string,
    roles: string[],
  ): Promise<AuthTokens> {
    const secret = new TextEncoder().encode(this.secret);
    const access = await new SignJWT({
      email,
      name,
      preferred_username: email,
      realm_access: { roles },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(secret);
    const refresh = await new SignJWT({ typ: 'Refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(secret);
    return { access_token: access, refresh_token: refresh, expires_in: 900 };
  }
}
