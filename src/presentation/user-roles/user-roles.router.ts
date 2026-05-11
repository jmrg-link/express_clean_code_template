import { Router } from 'express';
import type { IamPort } from '#domain/auth/iam.port';
import type { EventBusPort } from '#domain/shared/events/event-bus.port';
import type { JwtMiddleware } from '#presentation/bootstrap/middlewares/jwt.middleware';
import { checkRole } from '#presentation/bootstrap/middlewares/check-role.middleware';
import { validateObjectId } from '#presentation/bootstrap/middlewares/validate-object-id.middleware';
import { validate } from '#presentation/bootstrap/middlewares/validate.middleware';
import { ReplaceRolesSchema, RoleParamSchema } from '#domain/user-roles/user-roles.dto';
import { UserRolesFacade } from '#application/user-roles/user-roles.facade';
import { UserQueryRepository } from '#infrastructure/mongodb/repositories/user.query.repository';
import { UserCommandRepository } from '#infrastructure/mongodb/repositories/user.command.repository';
import { UserRolesController } from './user-roles.controller.js';

interface UserRolesRouterOptions {
  iam: IamPort;
  jwtMiddleware: JwtMiddleware;
  eventBus: EventBusPort;
}

/**
 * Router del CRUD de roles bajo `/users/:id/roles`.
 *
 * @remarks
 * Se monta en `app-router.ts` con prefijo `/users/:id/roles` y la instancia
 * usa `Router({ mergeParams: true })` para heredar `:id` del path padre.
 * Sigue el mismo DI-por-router del resto del repo: instancia sus repos +
 * facade aquí. Todas las rutas exigen `jwt + checkRole('admin')`.
 */
export class UserRolesRouter {
  private readonly router: Router;
  private readonly controller: UserRolesController;
  private readonly jwtMiddleware: JwtMiddleware;

  public constructor(options: UserRolesRouterOptions) {
    this.router = Router({ mergeParams: true });
    this.jwtMiddleware = options.jwtMiddleware;

    const queryRepo = new UserQueryRepository();
    const commandRepo = new UserCommandRepository();
    const facade = new UserRolesFacade(options.iam, queryRepo, commandRepo, options.eventBus);
    this.controller = new UserRolesController(facade);

    this.register();
  }

  public build(): Router {
    return this.router;
  }

  private register(): void {
    const jwt = this.jwtMiddleware.handle();
    const adminOnly = checkRole('admin');

    /**
     * @swagger
     * /users/{id}/roles:
     *   get:
     *     summary: List effective roles of a user (admin only)
     *     tags: [User Roles]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
     *     responses:
     *       200: { description: Current role set }
     *       401: { description: Unauthorized }
     *       403: { description: Forbidden }
     *       404: { description: User not found }
     */
    this.router.get('/', validateObjectId(), jwt, adminOnly, this.controller.list);

    /**
     * @swagger
     * /users/{id}/roles:
     *   put:
     *     summary: Replace the full role set (admin only)
     *     description: |
     *       Idempotent. Computes diff against current Mongo state, syncs
     *       Keycloak (assign + remove) and persists the final set. Emits
     *       `user.role_changed`. Self-demotion (actor removing own `admin`)
     *       is blocked with 400.
     *     tags: [User Roles]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [roles]
     *             properties:
     *               roles:
     *                 type: array
     *                 minItems: 1
     *                 items: { type: string, enum: [buyer, seller, operator, admin] }
     *     responses:
     *       200: { description: Roles replaced — final set returned }
     *       400: { description: Validation error or self-demotion attempt }
     *       401: { description: Unauthorized }
     *       403: { description: Forbidden }
     *       404: { description: User not found }
     *       502: { description: Failed to sync with IAM }
     */
    this.router.put(
      '/',
      validateObjectId(),
      jwt,
      adminOnly,
      validate.body(ReplaceRolesSchema),
      this.controller.replace,
    );

    /**
     * @swagger
     * /users/{id}/roles/{role}:
     *   post:
     *     summary: Add a single role to a user (admin only)
     *     description: |
     *       Idempotent. No-op if the user already has the role. Emits
     *       `user.role_changed` only when state actually changes.
     *     tags: [User Roles]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
     *       - in: path
     *         name: role
     *         required: true
     *         schema: { type: string, enum: [buyer, seller, operator, admin] }
     *     responses:
     *       204: { description: Role applied (or already present) }
     *       400: { description: Invalid role parameter }
     *       401: { description: Unauthorized }
     *       403: { description: Forbidden }
     *       404: { description: User not found }
     *       502: { description: Failed to sync with IAM }
     */
    this.router.post(
      '/:role',
      validateObjectId(),
      jwt,
      adminOnly,
      validate.params(RoleParamSchema),
      this.controller.add,
    );

    /**
     * @swagger
     * /users/{id}/roles/{role}:
     *   delete:
     *     summary: Remove a single role from a user (admin only)
     *     description: |
     *       Idempotent. No-op if the user does not have the role. Blocks
     *       self-demotion of `admin` with 400. Emits `user.role_changed`
     *       only when state actually changes.
     *     tags: [User Roles]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
     *       - in: path
     *         name: role
     *         required: true
     *         schema: { type: string, enum: [buyer, seller, operator, admin] }
     *     responses:
     *       204: { description: Role removed (or already absent) }
     *       400: { description: Invalid role or self-demotion attempt }
     *       401: { description: Unauthorized }
     *       403: { description: Forbidden }
     *       404: { description: User not found }
     *       502: { description: Failed to sync with IAM }
     */
    this.router.delete(
      '/:role',
      validateObjectId(),
      jwt,
      adminOnly,
      validate.params(RoleParamSchema),
      this.controller.remove,
    );
  }
}
