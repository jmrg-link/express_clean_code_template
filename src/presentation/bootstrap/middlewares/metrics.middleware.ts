import type { Request, RequestHandler, Response } from 'express';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Etiquetas comunes a todas las métricas HTTP. La cardinalidad se mantiene
 * baja porque `route` se toma de `req.route?.path` (patrón Express, no la
 * URL real con IDs).
 */
interface HttpLabels {
  method: string;
  route: string;
  status_code: string;
}

/**
 * Registro y métricas Prometheus para la API.
 *
 * @remarks
 * Encapsula el `Registry` de `prom-client` y expone:
 * - Métricas por defecto del proceso Node (CPU, RSS, event loop lag, GC).
 * - `http_requests_total` (counter por método/ruta/status).
 * - `http_request_duration_seconds` (histogram con buckets estándar).
 *
 * El handler `requestMetrics()` se registra como middleware global y mide
 * cada request hasta que la respuesta termina (`res.on('finish')`). El
 * handler `metricsEndpoint()` sirve el formato exposición Prometheus en
 * `/metrics` para que el job `api` de Prometheus lo scrapee.
 *
 * El middleware ignora el propio endpoint `/metrics` para no contaminar
 * los buckets con tráfico de scraping.
 */
export class PrometheusMetrics {
  public readonly registry: Registry;
  private readonly requestsTotal: Counter<keyof HttpLabels>;
  private readonly requestDuration: Histogram<keyof HttpLabels>;

  public constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.requestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total de peticiones HTTP atendidas, por método, ruta y status.',
      labelNames: ['method', 'route', 'status_code'] as const,
      registers: [this.registry],
    });

    this.requestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Latencia de las peticiones HTTP en segundos.',
      labelNames: ['method', 'route', 'status_code'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
  }

  /**
   * Middleware que mide duración + cuenta cada request al finalizar la
   * respuesta. Usar `app.use(metrics.requestMetrics())` antes de las rutas
   * para que `req.route` ya esté resuelto cuando dispara `finish`.
   */
  public requestMetrics(): RequestHandler {
    return (req, res, next) => {
      if (req.path === '/metrics') return next();

      const stop = this.requestDuration.startTimer();
      res.on('finish', () => {
        const labels = this.resolveLabels(req, res);
        this.requestsTotal.inc(labels);
        stop(labels);
      });
      next();
    };
  }

  /**
   * Handler para el endpoint `/metrics`. Devuelve el formato exposición
   * Prometheus (text/plain) con todas las series del registro.
   */
  public metricsEndpoint(): RequestHandler {
    return async (_req, res, next) => {
      try {
        res.set('Content-Type', this.registry.contentType);
        res.send(await this.registry.metrics());
      } catch (err) {
        next(err);
      }
    };
  }

  private resolveLabels(req: Request, res: Response): HttpLabels {
    const matched = req.route?.path ?? `${req.baseUrl}${req.path}`;
    return {
      method: req.method,
      route: matched.length > 0 ? matched : 'unmatched',
      status_code: String(res.statusCode),
    };
  }
}
