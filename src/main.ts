import { env } from '#config/env';
import { WinstonLoggerAdapter } from '#infrastructure/logger/winston.adapter';
import { KeycloakAdapter } from '#infrastructure/keycloak/keycloak.adapter';
import { S3StorageAdapter } from '#infrastructure/services/s3/s3-storage.adapter';
import { InMemoryEventBus } from '#infrastructure/events/in-memory-event-bus';
import { LoginAuditLogRepository } from '#infrastructure/mongodb/repositories/login-audit-log.repository';
import { UserCommandRepository } from '#infrastructure/mongodb/repositories/user.command.repository';
import { AuditLoginObserver } from '#application/audit/use-cases/audit-login.observer';
import { JwtMiddleware } from '#presentation/bootstrap/middlewares/jwt.middleware';
import { AppRouter } from '#presentation/bootstrap/app-router';
import { App } from '#presentation/bootstrap/app';
import { Server } from '#presentation/bootstrap/server';
import { UserRouter } from '#presentation/user/user.router';
import { AuthRouter } from '#presentation/auth/auth.router';
import { StorageRouter } from '#presentation/storage/storage.router';
import type { StoragePort } from '#domain/shared/storage/storage.port';

/**
 * Composition root.
 *
 * Aquí solo cableamos componentes TRANSVERSALES (los que comparten varias
 * features). Cada feature router se autocablea con sus repos y facade.
 *
 * Orden de inicialización:
 *   1. Logger (necesario para todo lo demás).
 *   2. EventBus (Observer pattern).
 *   3. AuditObserver suscrito al EventBus.
 *   4. IAM adapter (Keycloak).
 *   5. JwtMiddleware (depende de IAM port).
 *   6. S3 adapter (opcional).
 *   7. Routers (cada uno con su DI local).
 *   8. App + Server.
 */
async function main(): Promise<void> {
  const logger = await WinstonLoggerAdapter.create();
  logger.info('Bootstrapping application', {
    nodeEnv: env.server.nodeEnv,
    s3Configured: env.s3.isConfigured,
    lokiEnabled: Boolean(env.loki.host),
  });

  const eventBus = new InMemoryEventBus(logger);

  const auditRepo = new LoginAuditLogRepository();
  const userCommandForAudit = new UserCommandRepository();
  new AuditLoginObserver(auditRepo, userCommandForAudit, logger).register(eventBus);

  const iam = new KeycloakAdapter(logger);

  const jwtMiddleware = new JwtMiddleware(iam);

  let storage: StoragePort | undefined;
  let storageRouter: StorageRouter | undefined;
  if (env.s3.isConfigured) {
    storage = S3StorageAdapter.create(logger);
    storageRouter = new StorageRouter({ jwtMiddleware, storage });
  } else {
    logger.warn('S3 not configured: /storage endpoints disabled');
  }

  const userRouter = new UserRouter({ jwtMiddleware });
  const authRouter = new AuthRouter({ iam, jwtMiddleware, eventBus });

  const appRouter = new AppRouter({ userRouter, authRouter, storageRouter });
  const app = new App({ appRouter, logger });
  const server = new Server(app.getExpressApp(), logger);

  await server.start();
}

main().catch((err: unknown) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
