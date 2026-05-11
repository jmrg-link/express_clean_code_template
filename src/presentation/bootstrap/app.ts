import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { env } from '#config/env';
import { swaggerSpec } from '#config/swagger';
import { MongoDatabase } from '#config/database';
import type { LoggerPort } from '#domain/shared/logger/logger.port';
import { ErrorHandlerMiddleware } from './error-handler/error-handler.middleware.js';
import { globalRateLimiter } from './middlewares/rate-limit.middleware.js';
import { PrometheusMetrics } from './middlewares/metrics.middleware.js';
import { RequestContextMiddleware } from './middlewares/request-context.middleware.js';
import type { AppRouter } from './app-router.js';

interface AppOptions {
  appRouter: AppRouter;
  logger: LoggerPort;
}

export class App {
  private readonly expressApp: Application;
  private readonly appRouter: AppRouter;
  private readonly logger: LoggerPort;
  private readonly metrics: PrometheusMetrics;

  public constructor(options: AppOptions) {
    this.expressApp = express();
    this.appRouter = options.appRouter;
    this.logger = options.logger;
    this.metrics = new PrometheusMetrics();

    this.configureProxyTrust();
    this.registerRequestContext();
    this.registerGlobalMiddlewares();
    this.registerObservability();
    this.registerHealthChecks();
    this.registerSwagger();
    this.registerRoutes();
    this.registerErrorHandler();
  }

  /**
   * Habilita la confianza en el primer proxy upstream (Traefik) para que
   * Express resuelva la IP real del cliente desde `X-Forwarded-For`.
   *
   * @remarks
   * Imprescindible cuando la app corre detrás de Traefik:
   * - `express-rate-limit` aplica los límites por IP real, no por la del proxy.
   * - Los `audit logs` registran la IP del cliente, no la interna del LB.
   *
   * @see {@link https://expressjs.com/en/guide/behind-proxies.html}
   */
  private configureProxyTrust(): void {
    this.expressApp.set('trust proxy', 1);
  }

  private registerRequestContext(): void {
    this.expressApp.use(new RequestContextMiddleware(this.logger).handle());
  }

  private registerGlobalMiddlewares(): void {
    this.expressApp.use(helmet());
    this.expressApp.use(
      cors({
        origin: env.server.corsOrigins.length > 0 ? env.server.corsOrigins : false,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
        exposedHeaders: ['X-Request-Id'],
        credentials: true,
      }),
    );
    this.expressApp.use(express.json({ limit: '1mb' }));
    this.expressApp.use(express.urlencoded({ extended: true }));
    if (!env.server.isTest) this.expressApp.use(morgan('dev'));
    this.expressApp.use(globalRateLimiter);
  }

  /**
   * Registra el middleware de métricas Prometheus y el endpoint `/metrics`.
   *
   * @remarks
   * El middleware se monta tras los globales para que `req.route` esté
   * resuelto antes del evento `finish`. El endpoint `/metrics` es scrapeado
   * por el job `api` definido en `monitoring/prometheus.yml`.
   */
  private registerObservability(): void {
    this.expressApp.use(this.metrics.requestMetrics());
    this.expressApp.get('/metrics', this.metrics.metricsEndpoint());
  }

  private registerHealthChecks(): void {
    this.expressApp.get('/health/live', (_req, res) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });
    this.expressApp.get('/health/ready', (_req, res) => {
      const mongoOk = MongoDatabase.isHealthy();
      res.status(mongoOk ? 200 : 503).json({
        status: mongoOk ? 'ok' : 'degraded',
        mongo: mongoOk ? 'connected' : 'disconnected',
        uptime: process.uptime(),
      });
    });
    this.expressApp.get('/health', (_req, res) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });
  }

  private registerSwagger(): void {
    this.expressApp.get('/api-docs.json', (_req, res) => {
      res.type('application/json').send(swaggerSpec);
    });
    this.expressApp.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  }

  private registerRoutes(): void {
    this.expressApp.use(this.appRouter.prefix, this.appRouter.build());
  }

  private registerErrorHandler(): void {
    this.expressApp.use(ErrorHandlerMiddleware.build(this.logger));
  }

  public getExpressApp(): Application {
    return this.expressApp;
  }
}
