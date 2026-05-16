# Resumen ejecutivo del Codebase

Compactación generada por repomix — Estado actual del proyecto al 2026-05-10.

## Proyecto

**express-clean-backend** — Backend Express 5 + TypeScript con arquitectura Hexagonal + DDD-lite, Keycloak (jose) para IAM, CQRS-lite en repos, Facade por feature, Observer para auditoría, S3 storage, Winston/Loki logging y plataforma Traefik 3.7 + observability stack.

## Stack técnico

| Componente | Versión | Propósito |
|---|---|---|
| Node.js | ≥22.0.0 | Runtime |
| Express | 5.2.1 | Framework HTTP |
| TypeScript | 5.5.4 | Type safety |
| Mongoose | 9.2.0 | ODM MongoDB |
| Keycloak (via jose) | 6.1.3 | IAM + JWT |
| AWS SDK S3 | 3.654.0 | Object storage |
| Winston | 3.19.0 | Logging |
| Loki (winston-loki) | 6.1.3 | Log aggregation |
| Prometheus (prom-client) | 15.1.3 | Metricas |
| Traefik | 3.7 | Reverse proxy + ACME |
| Vitest | 4.0.18 | Unit + integration tests |
| Swagger JSDoc | 6.2.8 | OpenAPI docs |

## Estructura de capas (Hexagonal)

```
src/
├── domain/                 # Entidades, ports, DTOs, eventos (TypeScript + Zod puro)
│   ├── auth/              # Ports IAM
│   ├── user/              # Ports + entities usuarios
│   ├── audit/             # Eventos login
│   └── shared/            # Errors, logger port, storage port, event bus
├── application/           # Use-cases, Facades por feature
│   ├── auth/              # Login, register, refresh
│   ├── user/              # CRUD usuarios
│   ├── storage/           # Signed URLs
│   └── audit/             # Observer listener
├── infrastructure/        # Adapters concretos
│   ├── keycloak/          # Adapter Keycloak
│   ├── mongodb/           # Repositories Mongoose
│   ├── services/s3/       # Adapter S3
│   ├── logger/            # Adapter Winston
│   └── events/            # In-memory EventBus
├── presentation/          # Express routers, controllers, middlewares
│   ├── auth/              # /api/v1/auth endpoints
│   ├── user/              # /api/v1/users endpoints
│   ├── storage/           # /api/v1/storage endpoints
│   └── bootstrap/         # Error handling, middleware chain
├── config/                # Env Zod, Swagger config, DB singleton
└── main.ts               # Composition root
```

## Funcionalidades implementadas

### 1. Autenticación (OIDC + JWT)
- Keycloak 26.6.1 (jose 6.1.3 para JWT)
- Flujo: Keycloak → JWT (accessToken + refreshToken) → API
- Refresh token automático
- Roles: `admin` (regex email @<your-domain.tld>) y `user`

### 2. Gestión de usuarios
- CQRS-lite: `UserQueryRepositoryPort` (lectura), `UserCommandRepositoryPort` (escritura)
- Soft delete
- Login success/failure audit
- Paginación con `Paginator<T>`

### 3. Storage (S3)
- Presigned URLs GET/PUT/DELETE
- Validación CORS
- Ciclo de vida automático

### 4. Auditoría
- Observer pattern: `AuditLoginObserver` escucha eventos `LoginSuccessEvent`
- Collection TTL 90 días (MongoDB)

### 5. Logging + Observabilidad
- Winston: dev (console) / staging (file) / production (Loki)
- Decorator request-scoped con `request_id`
- Prometheus metricas (endpoints, latencia)
- Grafana dashboards + Loki datasource

## Patrones aplicados

| Patrón | Ubicación | Propósito |
|---|---|---|
| Adapter | Keycloak, Mongo, S3, Winston | Encajar librerías externas en ports |
| Facade | auth, user, storage | API estable por feature |
| Decorator | request-context-logger | Request-scoped logger |
| Chain of Responsibility | error-handler.middleware | Manejo de errores por niveles |
| Observer | EventBus + AuditLoginObserver | Auditoría desacoplada |
| Strategy | winston.adapter | Comportamiento por entorno |
| Template Method | error-handler.base | Flujo fijo, subclases impl `handle` |

## Configuración (Zod)

Archivo: `src/config/env.ts`

Tres perfiles:
1. **local**: `.env.local` (localhost, BD local, Keycloak mock opcional)
2. **staging**: `.env.staging` (EC2 dev, BD staging, KC real)
3. **production**: `.env.production` (EC2 prod, BD prod, KC prod)

Fail-fast al startup si env var falta o tipo invalido.

## Tests (Vitest)

Ubicación: `test/`

```
├── unit/              # Custom error, event-bus, paginator, slugger
├── integration/       # Auth (flow OIDC), Users (CRUD)
├── helpers/           # buildTestApp, fake adapters
└── setup.ts          # mongodb-memory-server auto-teardown
```

Cobertura actual: ~75% (auth, user, core logic). Sin mocks de BD (memory server in-process).

## Seguridad

### Hardening aplicado
- **Helmet**: headers CSP, HSTS, X-Frame-Options
- **Rate limit**: auth endpoints 10/windowMs, otros 100/windowMs
- **Validación Zod**: todos los DTOs
- **CORS**: `ALLOWED_ORIGINS` configurable
- **JWT**: validación via JWKS Keycloak
- **Soft delete**: datos nunca se borran permanentemente
- **Salting/Hashing**: Keycloak maneja (no local)

### Gaps documentados
- Mongoose injections: sanitización con Zod valida pero no sanitiza doble
- EC2 MongoDB sin TLS (roadmap)
- Secretos en `.env` sin rotación automática (script manual `rotate-keycloak-secrets.sh`)

## Infraestructura

### Local (docker-compose)
- API (Express port 3000)
- MongoDB (27017)
- Keycloak (8080)
- Grafana (3001)
- Prometheus (9090)
- Loki (3100)

### Staging/Production (EC2 + Traefik)
- Traefik 3.7: reverse proxy + ACME Let's Encrypt
- MongoDB: containerizado en EC2 t.micro (roadmap: cluster HA)
- API: multi-réplica detrás de Traefik
- OIDC middleware: protege paneles (Grafana, Prometheus)

## Diagrama macro

```
┌─────────────────┐
│  Client HTTP    │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Traefik │  (reverse proxy + ACME)
    └────┬────┘
         │
    ┌────▼────┐
    │   API   │  (Express + TypeScript)
    └────┬────┘
    ┌────┴─────────┬──────────┬────────┐
    │              │          │        │
┌───▼───┐    ┌─────▼─┐  ┌────▼──┐  ┌─▼───────┐
│MongoDB │    │Keycloak│  │AWS S3│  │Winston+Loki│
└────────┘    └────────┘  └──────┘  └────────────┘
```

## Archivos clave

| Archivo | Líneas | Propósito |
|---|---|---|
| `docker-compose.yml` | 150+ | Orquestación local (3 perfiles) |
| `docs/project/architecture.md` | 180+ | Visión arquitectónica |
| `docs/docker/platform.md` | 200+ | Traefik, ACME, Dockerfile |
| `src/main.ts` | 50+ | Composition root |
| `src/config/env.ts` | 120+ | Zod schema env |
| `test/integration/auth.integration.spec.ts` | 100+ | E2E auth flow |

## Métricas del codebase

- **Total archivos**: 115
- **Total tokens**: 113.223 (estimado)
- **Archivos TypeScript**: ~50
- **Archivos test**: ~15
- **Archivos doc**: 13 flat + 8 carpetas nuevas
- **Líneas código**: ~3500 (src/)
- **Líneas test**: ~800 (test/)
- **Líneas docs**: ~8000 (docs/)

## Roadmap (abierto)

1. EC2 MongoDB con TLS + backup cron S3
2. Redis cache decorator sobre `UserQueryRepository`
3. Kubernetes migration (K8s, Helm charts)
4. GraphQL layer (Apollo) complemento REST
5. Email service (SendGrid)
6. Rotación automática secrets (AWS Secrets Manager)
7. Disaster recovery (PITR, failover)

## Contacto / Ownership

- **Autor**: JMRG (jesus-maria-rico-gonzalez)
- **Proyecto**: express-clean-backend
- **GitHub**: jmrg-link/express-clean-backend (privado → próximamente public)
- **License**: MIT
