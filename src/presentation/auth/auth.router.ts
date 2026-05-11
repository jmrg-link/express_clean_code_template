import { Router } from 'express';
import type { IamPort } from '#domain/auth/iam.port';
import type { JwtMiddleware } from '#presentation/bootstrap/middlewares/jwt.middleware';
import type { EventBusPort } from '#domain/shared/events/event-bus.port';
import type { LoggerPort } from '#domain/shared/logger/logger.port';
import type { AdminEmailPattern } from '#domain/auth/admin-email-policy';
import { validate } from '#presentation/bootstrap/middlewares/validate.middleware';
import {
  loginRateLimiter,
  registerRateLimiter,
} from '#presentation/bootstrap/middlewares/rate-limit.middleware';
import {
  LoginSchema,
  RegisterSchema,
  RefreshSchema,
} from '#domain/auth/auth.dto';
import { AuthFacade } from '#application/auth/auth.facade';
import { UserQueryRepository } from '#infrastructure/mongodb/repositories/user.query.repository';
import { UserCommandRepository } from '#infrastructure/mongodb/repositories/user.command.repository';
import { AuthController } from './auth.controller.js';

interface AuthRouterOptions {
  iam: IamPort;
  jwtMiddleware: JwtMiddleware;
  eventBus: EventBusPort;
  adminEmailPatterns: ReadonlyArray<AdminEmailPattern>;
  logger: LoggerPort;
}

/**
 * Router de la feature Auth.
 *
 * Recibe `IamPort`, `JwtMiddleware` y `EventBusPort` (transversales) y ata el
 * resto en local: User repos + Facade + Controller. Login publica eventos
 * que un Observer registrado en main.ts persiste como audit logs.
 */
export class AuthRouter {
  private readonly router: Router;
  private readonly controller: AuthController;
  private readonly jwtMiddleware: JwtMiddleware;

  public constructor(options: AuthRouterOptions) {
    this.router = Router();
    this.jwtMiddleware = options.jwtMiddleware;

    const userQuery = new UserQueryRepository();
    const userCommand = new UserCommandRepository();
    const facade = new AuthFacade(
      options.iam,
      userQuery,
      userCommand,
      options.eventBus,
      options.adminEmailPatterns,
      options.logger,
    );
    this.controller = new AuthController(facade);

    this.register();
  }

  public build(): Router {
    return this.router;
  }

  private register(): void {
    /**
     * @swagger
     * /auth/login:
     *   post:
     *     summary: Authenticate via Keycloak password grant with local auto-sync
     *     description: |
     *       Validates credentials against Keycloak (resource-owner password
     *       grant), upserts the local user record from JWT claims and returns
     *       tokens. Rate-limited to 5 attempts per minute per client IP;
     *       successful logins do not consume the quota.
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [email, password]
     *             properties:
     *               email:    { type: string, format: email }
     *               password: { type: string, minLength: 1 }
     *     responses:
     *       200: { description: Access and refresh tokens plus user profile }
     *       400: { description: Invalid payload (Zod validation failed) }
     *       401: { description: Invalid credentials }
     *       429: { description: Too many login attempts from this IP }
     */
    this.router.post(
      '/login',
      loginRateLimiter,
      validate.body(LoginSchema),
      this.controller.login,
    );

    /**
     * @swagger
     * /auth/register:
     *   post:
     *     summary: Register a new user in Keycloak and local database
     *     description: |
     *       Creates the user in Keycloak (via admin API), persists it locally
     *       and returns access/refresh tokens. Rate-limited to 3 attempts per
     *       minute per client IP to mitigate mass-registration abuse.
     *
     *       Breaking change: el campo `name` se sustituye por `firstName` y
     *       `lastName`, ambos requeridos. KC almacena ambos nativamente.
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [email, password, firstName, lastName]
     *             properties:
     *               email:     { type: string, format: email }
     *               password:  { type: string, minLength: 8, maxLength: 72 }
     *               firstName: { type: string, minLength: 2, maxLength: 50 }
     *               lastName:  { type: string, minLength: 1, maxLength: 50 }
     *               phone:     { type: string }
     *     responses:
     *       201: { description: User registered, tokens issued }
     *       400: { description: Invalid payload (Zod validation failed) }
     *       409: { description: Email already exists in Keycloak or local DB }
     *       429: { description: Too many registration attempts from this IP }
     */
    this.router.post(
      '/register',
      registerRateLimiter,
      validate.body(RegisterSchema),
      this.controller.register,
    );

    /**
     * @swagger
     * /auth/refresh:
     *   post:
     *     summary: Exchange a refresh token for a fresh access/refresh pair
     *     description: |
     *       Delegates to Keycloak's `refresh_token` grant. Returns a new
     *       access token (and rotated refresh token) without re-prompting
     *       for credentials.
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [refresh_token]
     *             properties:
     *               refresh_token: { type: string }
     *     responses:
     *       200: { description: New access and refresh tokens }
     *       400: { description: Invalid payload (Zod validation failed) }
     *       401: { description: Invalid or expired refresh token }
     */
    this.router.post('/refresh', validate.body(RefreshSchema), this.controller.refresh);

    /**
     * @swagger
     * /auth/me:
     *   get:
     *     summary: Return the profile of the authenticated user
     *     description: |
     *       Resolves the local user record by `keycloak_id` claim contained in
     *       the verified bearer token (no DB lookup by email).
     *     tags: [Auth]
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200: { description: User profile }
     *       401: { description: Missing or invalid bearer token }
     *       404: { description: Token valid but user not found in local DB }
     */
    this.router.get('/me', this.jwtMiddleware.handle(), this.controller.me);
  }
}
