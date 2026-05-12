import type { Application } from 'express';
import { JwtMiddleware } from '#presentation/bootstrap/middlewares/jwt.middleware';
import { AppRouter } from '#presentation/bootstrap/app-router';
import { App } from '#presentation/bootstrap/app';
import { UserRouter } from '#presentation/user/user.router';
import { UserRolesRouter } from '#presentation/user-roles/user-roles.router';
import { UserStorageRouter } from '#presentation/user-storage/user-storage.router';
import { AuthRouter } from '#presentation/auth/auth.router';
import { InMemoryEventBus } from '#infrastructure/events/in-memory-event-bus';
import { UserQueryRepository } from '#infrastructure/mongodb/repositories/user.query.repository';
import type { IamPort } from '#domain/auth/iam.port';
import type { StoragePort } from '#domain/shared/storage/storage.port';
import type { LoggerPort } from '#domain/shared/logger/logger.port';

const noopLogger: LoggerPort = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
};

/**
 * Construye una Express App equivalente a la de producción pero inyectando
 * un IamPort fake. Devuelve la `Application` lista para `supertest(app)`.
 *
 * No registra el AuditObserver — los tests que quieran verificarlo lo
 * suscriben ellos al eventBus que pueden obtener vía `buildTestAppWithBus`.
 */
export interface BuildTestAppOptions {
  adminEmailPatterns?: ReadonlyArray<string>;
  storage?: StoragePort;
}

export function buildTestApp(iam: IamPort, options: BuildTestAppOptions = {}): Application {
  const eventBus = new InMemoryEventBus(noopLogger);
  const jwtMiddleware = new JwtMiddleware(iam);
  const userRouter = new UserRouter({ jwtMiddleware });
  const userRolesRouter = new UserRolesRouter({ iam, jwtMiddleware, eventBus });
  const authRouter = new AuthRouter({
    iam,
    jwtMiddleware,
    eventBus,
    adminEmailPatterns: options.adminEmailPatterns ?? [],
    logger: noopLogger,
  });
  const userStorageRouter = options.storage
    ? new UserStorageRouter({
        jwtMiddleware,
        storage: options.storage,
        userQuery: new UserQueryRepository(),
      })
    : undefined;
  const appRouter = new AppRouter({
    userRouter,
    userRolesRouter,
    authRouter,
    userStorageRouter,
  });
  return new App({ appRouter, logger: noopLogger }).getExpressApp();
}

export function buildTestAppWithBus(iam: IamPort): {
  app: Application;
  eventBus: InMemoryEventBus;
  logger: LoggerPort;
} {
  const eventBus = new InMemoryEventBus(noopLogger);
  const jwtMiddleware = new JwtMiddleware(iam);
  const userRouter = new UserRouter({ jwtMiddleware });
  const userRolesRouter = new UserRolesRouter({ iam, jwtMiddleware, eventBus });
  const authRouter = new AuthRouter({
    iam,
    jwtMiddleware,
    eventBus,
    adminEmailPatterns: [],
    logger: noopLogger,
  });
  const appRouter = new AppRouter({ userRouter, userRolesRouter, authRouter });
  const app = new App({ appRouter, logger: noopLogger }).getExpressApp();
  return { app, eventBus, logger: noopLogger };
}
