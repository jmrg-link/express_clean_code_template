import { Router } from 'express';
import type { StoragePort } from '#domain/shared/storage/storage.port';
import type { UserQueryRepositoryPort } from '#domain/user/user.repository.port';
import type { JwtMiddleware } from '#presentation/bootstrap/middlewares/jwt.middleware';
import { checkRole } from '#presentation/bootstrap/middlewares/check-role.middleware';
import { validate } from '#presentation/bootstrap/middlewares/validate.middleware';
import {
  RequestUploadUrlBodySchema,
  ListUserFilesQuerySchema,
  DownloadUrlQuerySchema,
  AdminUserIdParamSchema,
  EncodedKeyParamSchema,
} from '#domain/shared/storage/user-storage.dto';
import { UserStorageFacade } from '#application/user-storage/user-storage.facade';
import { UserStorageController } from './user-storage.controller.js';

interface UserStorageRouterOptions {
  jwtMiddleware: JwtMiddleware;
  storage: StoragePort;
  userQuery: UserQueryRepositoryPort;
}

/**
 * Router del subsistema user-storage. Expone 8 endpoints bajo `/storage`:
 *   - `/me/*` — el usuario gestiona sus propios objetos.
 *   - `/users/:id/*` — admin opera sobre cualquier usuario.
 *
 * El path param `:key` viaja siempre **base64url-encoded** para acomodar las
 * `/` internas de la key S3. El controller lo decodifica antes de delegar.
 */
export class UserStorageRouter {
  private readonly router: Router;
  private readonly controller: UserStorageController;
  private readonly jwtMiddleware: JwtMiddleware;

  public constructor(options: UserStorageRouterOptions) {
    this.router = Router();
    this.jwtMiddleware = options.jwtMiddleware;
    const facade = new UserStorageFacade(options.storage);
    this.controller = new UserStorageController(facade, options.userQuery);
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
     * /storage/me/upload-url:
     *   post:
     *     summary: Issue a presigned PUT URL for the authenticated user
     *     description: |
     *       Devuelve URL prefirmada (PUT directo cliente→S3) bajo el prefijo
     *       `users/{mi-slug}/{categoria}/...`. El cliente DEBE enviar el mismo
     *       `Content-Type` que firmó la URL.
     *     tags: [User Storage]
     *     security: [{ bearerAuth: [] }]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [category, filename, contentType]
     *             properties:
     *               category:        { type: string, enum: [avatars, documents, attachments] }
     *               filename:        { type: string, minLength: 1, maxLength: 255 }
     *               contentType:     { type: string, minLength: 3, maxLength: 127 }
     *               contentLength:   { type: integer, minimum: 1 }
     *               expiresInSeconds: { type: integer, minimum: 60, maximum: 900, default: 900 }
     *     responses:
     *       200: { description: URL emitida }
     *       400: { description: Body inválido o MIME no permitido }
     *       401: { description: Sin JWT }
     *       404: { description: User local no encontrado }
     *       502: { description: Storage adapter falla }
     */
    this.router.post(
      '/me/upload-url',
      jwt,
      validate.body(RequestUploadUrlBodySchema),
      this.controller.requestUploadSelf,
    );

    /**
     * @swagger
     * /storage/me:
     *   get:
     *     summary: List own files (paginated, optional category filter)
     *     tags: [User Storage]
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: query
     *         name: category
     *         schema: { type: string, enum: [avatars, documents, attachments] }
     *       - in: query
     *         name: maxKeys
     *         schema: { type: integer, default: 100, maximum: 1000 }
     *       - in: query
     *         name: continuationToken
     *         schema: { type: string }
     *     responses:
     *       200: { description: Lista paginada }
     *       400: { description: Query inválida }
     *       401: { description: Sin JWT }
     *       404: { description: User local no encontrado }
     */
    this.router.get(
      '/me',
      jwt,
      validate.query(ListUserFilesQuerySchema),
      this.controller.listSelf,
    );

    /**
     * @swagger
     * /storage/me/{key}/download-url:
     *   get:
     *     summary: Issue a presigned GET URL for an own object
     *     description: |
     *       `key` viaja base64url-encoded. El use-case rechaza con 403 si la
     *       key no empieza con `users/{mi-slug}/`.
     *     tags: [User Storage]
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: key
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: expiresIn
     *         schema: { type: integer, minimum: 60, maximum: 900, default: 900 }
     *     responses:
     *       200: { description: URL firmada }
     *       400: { description: Encoding inválido o key insegura }
     *       401: { description: Sin JWT }
     *       403: { description: La key no pertenece al usuario }
     *       404: { description: User local no encontrado }
     */
    this.router.get(
      '/me/:key/download-url',
      jwt,
      validate.params(EncodedKeyParamSchema),
      validate.query(DownloadUrlQuerySchema),
      this.controller.downloadSelf,
    );

    /**
     * @swagger
     * /storage/me/{key}:
     *   delete:
     *     summary: Delete an own object (idempotent)
     *     tags: [User Storage]
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: key
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       204: { description: Borrado (o ya inexistente) }
     *       400: { description: Encoding inválido }
     *       401: { description: Sin JWT }
     *       403: { description: La key no pertenece al usuario }
     *       404: { description: User local no encontrado }
     */
    this.router.delete(
      '/me/:key',
      jwt,
      validate.params(EncodedKeyParamSchema),
      this.controller.deleteSelf,
    );

    /**
     * @swagger
     * /storage/users/{id}/upload-url:
     *   post:
     *     summary: Issue a presigned PUT URL on behalf of any user (admin)
     *     tags: [User Storage]
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: Mongo `_id` o `keycloak_id` (resuelto en ese orden)
     *         schema: { type: string }
     *     responses:
     *       200: { description: URL emitida }
     *       400: { description: Body inválido o MIME no permitido }
     *       401: { description: Sin JWT }
     *       403: { description: No admin }
     *       404: { description: User target no encontrado }
     */
    this.router.post(
      '/users/:id/upload-url',
      jwt,
      adminOnly,
      validate.params(AdminUserIdParamSchema),
      validate.body(RequestUploadUrlBodySchema),
      this.controller.requestUploadAdmin,
    );

    /**
     * @swagger
     * /storage/users/{id}:
     *   get:
     *     summary: List files of any user (admin)
     *     tags: [User Storage]
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: category
     *         schema: { type: string, enum: [avatars, documents, attachments] }
     *       - in: query
     *         name: maxKeys
     *         schema: { type: integer, default: 100, maximum: 1000 }
     *       - in: query
     *         name: continuationToken
     *         schema: { type: string }
     *     responses:
     *       200: { description: Lista paginada }
     *       401: { description: Sin JWT }
     *       403: { description: No admin }
     *       404: { description: User target no encontrado }
     */
    this.router.get(
      '/users/:id',
      jwt,
      adminOnly,
      validate.params(AdminUserIdParamSchema),
      validate.query(ListUserFilesQuerySchema),
      this.controller.listAdmin,
    );

    /**
     * @swagger
     * /storage/users/{id}/{key}/download-url:
     *   get:
     *     summary: Issue presigned GET URL for any user's object (admin)
     *     tags: [User Storage]
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: key
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: expiresIn
     *         schema: { type: integer, minimum: 60, maximum: 900, default: 900 }
     *     responses:
     *       200: { description: URL firmada }
     *       400: { description: Encoding inválido o key insegura }
     *       401: { description: Sin JWT }
     *       403: { description: No admin o key fuera del prefix }
     *       404: { description: User target no encontrado }
     */
    this.router.get(
      '/users/:id/:key/download-url',
      jwt,
      adminOnly,
      validate.params(AdminUserIdParamSchema.merge(EncodedKeyParamSchema)),
      validate.query(DownloadUrlQuerySchema),
      this.controller.downloadAdmin,
    );

    /**
     * @swagger
     * /storage/users/{id}/{key}:
     *   delete:
     *     summary: Delete any user's object (admin, idempotent)
     *     tags: [User Storage]
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: key
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       204: { description: Borrado (o ya inexistente) }
     *       401: { description: Sin JWT }
     *       403: { description: No admin o key fuera del prefix }
     *       404: { description: User target no encontrado }
     */
    this.router.delete(
      '/users/:id/:key',
      jwt,
      adminOnly,
      validate.params(AdminUserIdParamSchema.merge(EncodedKeyParamSchema)),
      this.controller.deleteAdmin,
    );
  }
}
