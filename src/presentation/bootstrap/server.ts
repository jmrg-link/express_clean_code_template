import type { Server as HttpServer } from 'node:http';
import type { Application } from 'express';
import { env } from '#config/env';
import { MongoDatabase } from '#config/database';
import type { LoggerPort } from '#domain/shared/logger/logger.port';

/**
 * Wrapper sobre `app.listen` que añade graceful shutdown:
 *   1. SIGTERM/SIGINT → para de aceptar conexiones nuevas.
 *   2. Espera a que terminen las en curso (timeout 10s).
 *   3. Cierra la pool de Mongo.
 *   4. process.exit(0).
 */
export class Server {
  private httpServer?: HttpServer;
  private shuttingDown = false;

  public constructor(
    private readonly expressApp: Application,
    private readonly logger: LoggerPort,
  ) {}

  public async start(): Promise<void> {
    await MongoDatabase.connect(this.logger);

    await new Promise<void>((resolve) => {
      this.httpServer = this.expressApp.listen(env.server.port, env.server.host, () => {
        this.logger.info('🚀 Server running', {
          url: `http://${env.server.host}:${env.server.port}`,
          docs: `http://${env.server.host}:${env.server.port}/api-docs`,
          keycloak: `${env.keycloak.url}/realms/${env.keycloak.realm}`,
          environment: env.server.nodeEnv,
        });
        resolve();
      });
    });

    this.bindShutdownSignals();
  }

  public async stop(): Promise<void> {
    if (!this.httpServer) return;
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private bindShutdownSignals(): void {
    const handler = (signal: NodeJS.Signals): void => {
      void this.shutdown(signal);
    };
    process.on('SIGTERM', handler);
    process.on('SIGINT', handler);
  }

  private async shutdown(signal: NodeJS.Signals): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.warn(`Received ${signal}, starting graceful shutdown`);

    const forceTimeout = setTimeout(() => {
      this.logger.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    forceTimeout.unref();

    try {
      await this.stop();
      this.logger.info('HTTP server closed');
      await MongoDatabase.disconnect(this.logger);
      this.logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      this.logger.error('Error during shutdown', { error: (err as Error).message });
      process.exit(1);
    }
  }
}
