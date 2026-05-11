import { Router } from 'express';
import type { JwtMiddleware } from '#presentation/bootstrap/middlewares/jwt.middleware';
import { checkRole } from '#presentation/bootstrap/middlewares/check-role.middleware';
import { validateObjectId } from '#presentation/bootstrap/middlewares/validate-object-id.middleware';
import { validate } from '#presentation/bootstrap/middlewares/validate.middleware';
import {
  CreateUserSchema,
  UpdateUserSchema,
  ListUserSchema,
} from '#domain/user/user.dto';
import { UserFacade } from '#application/user/user.facade';
import { UserQueryRepository } from '#infrastructure/mongodb/repositories/user.query.repository';
import { UserCommandRepository } from '#infrastructure/mongodb/repositories/user.command.repository';
import { UserController } from './user.controller.js';

interface UserRouterOptions {
  jwtMiddleware: JwtMiddleware;
}

/**
 * Router de la feature User.
 *
 * Patrón clave del proyecto (decisión del usuario):
 *   "DI en el router de cada entidad".
 *
 * Esto significa que el router INSTANCIA sus propios repos y facade en su
 * constructor. main.ts NO sabe de repos de User.
 *
 * Ventajas:
 *   - main.ts queda mínimo: solo ata cosas TRANSVERSALES (Mongo, Keycloak,
 *     JwtMiddleware, AppRouter).
 *   - Cada feature es un "paquete autónomo": copiar/mover el folder se lleva
 *     todo lo necesario.
 *   - Tests del router pueden inyectar mocks vía constructor.
 *
 * Lo único que recibe de fuera es el `JwtMiddleware` (transversal — no es
 * de User, lo comparten todas las features autenticadas).
 */
export class UserRouter {
  private readonly router: Router;
  private readonly controller: UserController;
  private readonly jwtMiddleware: JwtMiddleware;

  public constructor(options: UserRouterOptions) {
    this.router = Router();
    this.jwtMiddleware = options.jwtMiddleware;

    const queryRepo = new UserQueryRepository();
    const commandRepo = new UserCommandRepository();
    const facade = new UserFacade(queryRepo, commandRepo);
    this.controller = new UserController(facade);

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
     * /users:
     *   get:
     *     summary: List users (admin only)
     *     tags: [Users]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: email
     *         schema: { type: string }
     *       - in: query
     *         name: firstName
     *         description: Case-insensitive contains match on `firstName`.
     *         schema: { type: string }
     *       - in: query
     *         name: is_active
     *         schema: { type: string, enum: ['true', 'false'] }
     *       - in: query
     *         name: roles
     *         schema: { type: string, enum: [buyer, seller, operator, admin] }
     *       - in: query
     *         name: page
     *         schema: { type: integer, default: 1 }
     *       - in: query
     *         name: limit
     *         schema: { type: integer, default: 20 }
     *     responses:
     *       200: { description: List of users with pagination }
     *       401: { description: Unauthorized }
     *       403: { description: Forbidden }
     */
    this.router.get('/', jwt, adminOnly, validate.query(ListUserSchema), this.controller.list);

    /**
     * @swagger
     * /users/{id}:
     *   get:
     *     summary: Get user by id (admin only)
     *     tags: [Users]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
     *     responses:
     *       200: { description: User detail }
     *       404: { description: Not found }
     */
    this.router.get('/:id', validateObjectId(), jwt, adminOnly, this.controller.show);

    /**
     * @swagger
     * /users:
     *   post:
     *     summary: Create user in local DB (admin only)
     *     tags: [Users]
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       201: { description: User created }
     *       400: { description: Validation error }
     *       409: { description: Email already registered }
     */
    this.router.post('/', jwt, adminOnly, validate.body(CreateUserSchema), this.controller.create);

    /**
     * @swagger
     * /users/{id}:
     *   put:
     *     summary: Update user (admin only)
     *     tags: [Users]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
     *     responses:
     *       200: { description: User updated }
     *       404: { description: Not found }
     */
    this.router.put(
      '/:id',
      validateObjectId(),
      jwt,
      adminOnly,
      validate.body(UpdateUserSchema),
      this.controller.update,
    );

    /**
     * @swagger
     * /users/{id}:
     *   delete:
     *     summary: Soft-delete user (is_active=false, admin only)
     *     tags: [Users]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
     *     responses:
     *       200: { description: User deactivated }
     *       404: { description: Not found }
     */
    this.router.delete('/:id', validateObjectId(), jwt, adminOnly, this.controller.remove);
  }
}
