import { Router } from 'express';
import { env } from '#config/env';
import type { UserRouter } from '#presentation/user/user.router';
import type { AuthRouter } from '#presentation/auth/auth.router';
import type { StorageRouter } from '#presentation/storage/storage.router';
import type { UserRolesRouter } from '#presentation/user-roles/user-roles.router';

interface AppRouterOptions {
  userRouter: UserRouter;
  authRouter: AuthRouter;
  userRolesRouter: UserRolesRouter;
  /** Opcional: solo si S3 está configurado. */
  storageRouter?: StorageRouter;
}

/**
 * Compone los routers de feature bajo el prefijo `/api/v1`.
 *
 * `storageRouter` es opcional: si las envs de S3 no están completas, main.ts
 * lo omite y este endpoint simplemente no existe (mejor 404 que 500 en runtime).
 */
export class AppRouter {
  public readonly prefix: string;
  private readonly userRouter: UserRouter;
  private readonly authRouter: AuthRouter;
  private readonly userRolesRouter: UserRolesRouter;
  private readonly storageRouter?: StorageRouter;

  public constructor(options: AppRouterOptions) {
    this.prefix = `${env.server.apiPrefix}/${env.server.apiVersion}`;
    this.userRouter = options.userRouter;
    this.authRouter = options.authRouter;
    this.userRolesRouter = options.userRolesRouter;
    this.storageRouter = options.storageRouter;
  }

  public build(): Router {
    const router = Router();
    router.use('/auth', this.authRouter.build());
    router.use('/users/:id/roles', this.userRolesRouter.build());
    router.use('/users', this.userRouter.build());
    if (this.storageRouter) {
      router.use('/storage', this.storageRouter.build());
    }
    return router;
  }
}
