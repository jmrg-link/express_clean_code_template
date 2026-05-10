import { Router } from 'express';
import type { JwtMiddleware } from '#presentation/bootstrap/middlewares/jwt.middleware';
import type { StoragePort } from '#domain/shared/storage/storage.port';
import { checkRole } from '#presentation/bootstrap/middlewares/check-role.middleware';
import { validate } from '#presentation/bootstrap/middlewares/validate.middleware';
import {
  ListStorageQuerySchema,
  SignedUrlParamsSchema,
} from '#domain/shared/storage/storage.dto';
import { StorageFacade } from '#application/storage/storage.facade';
import { StorageController } from './storage.controller.js';

interface StorageRouterOptions {
  jwtMiddleware: JwtMiddleware;
  /** Inyectado desde main.ts. NO se construye aquí porque depende del logger. */
  storage: StoragePort;
}

/**
 * Router de Storage. Patrón clave (decisión del usuario):
 *   "S3 cliente librería inicializada en infra services"
 *   "se hace DI de la clase a donde se va a usar"
 *
 * El cliente S3 se construye UNA VEZ en main.ts (singleton) y se inyecta
 * vía StoragePort a este router (y a cualquier otro use-case futuro que
 * lo necesite, ej. UserFacade para subir avatares).
 */
export class StorageRouter {
  private readonly router: Router;
  private readonly controller: StorageController;
  private readonly jwtMiddleware: JwtMiddleware;

  public constructor(options: StorageRouterOptions) {
    this.router = Router();
    this.jwtMiddleware = options.jwtMiddleware;
    const facade = new StorageFacade(options.storage);
    this.controller = new StorageController(facade);
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
     * /storage/objects:
     *   get:
     *     summary: List objects in S3 bucket (admin only)
     *     tags: [Storage]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: prefix
     *         schema: { type: string }
     *       - in: query
     *         name: maxKeys
     *         schema: { type: integer, default: 100, maximum: 1000 }
     *       - in: query
     *         name: continuationToken
     *         schema: { type: string }
     *     responses:
     *       200: { description: List of objects with continuation token }
     *       403: { description: Forbidden (admin only) }
     */
    this.router.get(
      '/objects',
      jwt,
      adminOnly,
      validate.query(ListStorageQuerySchema),
      this.controller.list,
    );

    /**
     * @swagger
     * /storage/signed-url:
     *   get:
     *     summary: Get signed download URL for an object (admin only)
     *     tags: [Storage]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: key
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: expiresIn
     *         schema: { type: integer, default: 900, maximum: 3600 }
     *     responses:
     *       200: { description: Signed URL with TTL }
     *       400: { description: Invalid key }
     */
    this.router.get(
      '/signed-url',
      jwt,
      adminOnly,
      validate.query(SignedUrlParamsSchema),
      this.controller.sign,
    );
  }
}
