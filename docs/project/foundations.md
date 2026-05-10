# Fundamentos

> Capítulo de entrada. Define qué es el proyecto, su stack técnico,
> prerequisitos y glosario.

---

## Qué es

Backend HTTP/JSON en Express 5 con arquitectura **hexagonal estricta**.
Sirve como plantilla para arrancar APIs limpias en TypeScript con Mongoose,
Keycloak y S3, y como referencia de DDD-lite, CQRS-lite, Facade, Observer,
Adapter y Chain of Responsibility en un servicio real.

No es un microservicio de un dominio concreto: es una base reutilizable
con auth, gestión de usuarios, storage y auditoría, sobre la que añadir
features de negocio.

## Para quién

| Audiencia | Qué saca |
|---|---|
| Backend dev nuevo en el repo | Sabe en una hora dónde añadir features sin romper la disciplina hexagonal |
| Arquitecto / tech lead | Material para discutir trade-offs (CQRS-lite vs canónico, DI por router, etc.) |
| DevOps / SRE | Plataforma compose con Traefik 3.7 + observability stack provisionable |
| QA / Auditor | Trazabilidad de cada endpoint → use-case → adapter |

---

## Stack técnico

| Capa | Tecnología | Versión | Dónde se usa |
|---|---|---|---|
| Runtime | Node.js | >= 22.0.0 (`package.json:engines`) | Todo |
| Lenguaje | TypeScript | 5.5.4 | Todo |
| Módulos | ESM nativo | `type:module` (`package.json:5`) | Imports `#feature/*` resueltos por `imports` map |
| HTTP | Express | 5.2.1 | `presentation/**` |
| Validación | Zod | ^4.3.6 | DTOs en `domain/**`, env Zod en `config/env.ts` |
| Base de datos | MongoDB + Mongoose | 9.2.0 (`package.json:82`) | `infrastructure/mongodb/**` |
| IAM | Keycloak + jose | KC 26.6.1 / jose 6.1.3 | `infrastructure/keycloak/**` |
| Storage | AWS S3 SDK v3 | 3.654.0 | `infrastructure/services/s3/**` (montaje condicional) |
| Logging | Winston + winston-loki | 3.19.0 / 6.1.3 | `infrastructure/logger/**` |
| Rate-limit | express-rate-limit | 7.4.0 | `presentation/bootstrap/middlewares/rate-limit.middleware.ts` |
| Security headers | helmet | 8.1.0 | `presentation/bootstrap/app.ts` |
| Tests | Vitest + supertest + mongodb-memory-server | 4 / 7 / 11 | `test/**` |
| Docs API | swagger-jsdoc + swagger-ui-express | 6.2.8 / 5.0.1 | `config/swagger.ts` (servida en `/api-docs`) |
| Plataforma | Docker + Docker Compose | — | `compose.yaml` + perfiles |
| Reverse proxy | Traefik | 3.7.0-ea.1 (early-access) | `infrastructure/traefik/**` |
| Observabilidad | Loki / Grafana / Prometheus | 3.7.1 / 13.0.1 / 3.8.1 | Stack opcional perfil `observability` |

---

## Visión general

La arquitectura es hexagonal y se verifica por grep: cero imports de
`mongoose | express | aws | keycloak | jose | winston` en `src/domain/**`
ni `src/application/**`. El dominio define ports y entidades planas; la
aplicación compone use-cases unitarios y los expone vía Facades por feature;
la infraestructura implementa los ports con adapters concretos; la
presentación adapta HTTP a casos de uso. La identidad de usuario se ancla
en `keycloak_id` (sub del JWT), no en el `_id` de Mongo, lo que evita IDOR
y permite migrar de base de datos sin perder usuarios.

La plataforma se levanta con docker compose y tres perfiles (`default`,
`dev`, `observability`) sobre tres redes Docker (`proxy`, `backend`,
`monitoring`). Traefik 3.7-ea termina TLS vía ACME y valida sesiones de
humanos (Grafana, Prometheus, dashboard) con el plugin OIDC contra Keycloak.
La API Express recibe tráfico ya en HTTP plano dentro de la red `backend`
y verifica JWT por su cuenta usando `jose.createRemoteJWKSet`.

El logging es estructurado con Winston y aplica una Strategy según entorno
(dev / staging / production). Cuando hay `LOKI_HOST` y el entorno es
production o staging, exporta a Loki. La auditoría de logins se persiste
en la collection `LoginAuditLog` con TTL de 90 días. Las métricas Prometheus
y los dashboards Grafana viven en [`../aws/observability.md`](../aws/observability.md).

---

## Glosario

| Término | Definición |
|---|---|
| **Hexagonal (Ports & Adapters)** | Arquitectura donde el dominio define interfaces (`ports`) y la infraestructura las implementa con `adapters`; el dominio no conoce los detalles de I/O. → [arquitectura](architecture.md) |
| **DDD-lite** | Domain-Driven Design pragmático: entidades planas, sin agregados ricos. La lógica vive en use-cases. Trade-off conocido: anémico consciente. |
| **CQRS-lite** | Separación de interfaz `Query` vs `Command` para repos. No es event sourcing; ambos repos tocan la misma collection. Habilita ISP y un cache decorator a futuro. → [arquitectura](architecture.md) |
| **Facade** | Una clase por feature (`AuthFacade`, `UserFacade`, `StorageFacade`) que agrupa use-cases y expone una API estable al controller. Reduce el número de inyecciones por router. |
| **Observer (EventBus)** | Patrón comportamental: el publisher no conoce a los subscribers. `LoginUseCase` publica `user.logged_in`, `AuditLoginObserver` lo persiste. → [features](features.md) |
| **Adapter** | Implementación concreta de un port. `KeycloakAdapter` implementa `IamPort`; `UserCommandRepository` implementa `UserCommandRepositoryPort`. |
| **Decorator** | `RequestContextLoggerDecorator` envuelve el logger global con `request_id` por request. Patrón estructural. |
| **Chain of Responsibility** | Cadena de error handlers (`Zod → Client → Server → Mongo → Fallback`); cada uno decide si responde o delega. → [api/reference](../api/reference.md) |
| **Port** | Interfaz en `domain/`: contrato sin implementación. Por ejemplo `IamPort`, `StoragePort`. |
| **Use-case** | Una operación de negocio en un archivo: `application/<feature>/use-cases/*.ts`. Orquesta ports y reglas. |
| **Composition root** | Punto único donde se cablean dependencias transversales (`src/main.ts`). Cada feature router se autocablea con sus repos locales. |
| **DI por feature router** | El patrón del proyecto: `main.ts` solo cablea transversales (logger, eventBus, IAM, jwt, S3); cada router instancia sus propios repos y facade. → [arquitectura](architecture.md) |
| **Auto-sync (login)** | Si las claims del JWT no encuentran un User local en BBDD, `LoginUseCase` lo crea sobre la marcha. Permite login con usuarios creados directamente en Keycloak. |
| **JWKS** | JSON Web Key Set. Endpoint del IDP que publica las claves públicas RSA usadas para firmar tokens. `jose.createRemoteJWKSet` lo cachea con rotación automática. |
| **OIDC** | OpenID Connect sobre OAuth2. El plugin Traefik OIDC valida sesiones humanas; la API valida JWT directamente con jose. |
| **ACME** | Protocolo Let's Encrypt para emisión automática de certificados TLS. Lo usa Traefik. |
| **Presigned URL** | URL S3 firmada con TTL (default 15 min) que da acceso temporal a un objeto sin exponer credenciales. Solo GET; no soportamos PUT presigned. → [features](features.md) |
| **Soft-delete** | Marca `is_active=false` en lugar de borrar la fila. Se usa en `UserCommandRepositoryPort.softDelete`. |
| **`keycloak_id`** | Identificador estable del usuario (claim `sub` del JWT). Anti-IDOR, anti-acoplamiento al `_id` de Mongo. |
| **Singleton (MongoDatabase)** | `MongoDatabase` mantiene una única conexión Mongoose para todo el proceso. Idempotente: `connect()` reutiliza la conexión abierta. |
| **Healthcheck `live` vs `ready`** | `live`: el proceso responde. `ready`: las dependencias críticas (Mongo) están OK. Convención Kubernetes. |
| **Path-traversal guard** | `key.includes('..')` en `GetSignedUrlUseCase` para evitar firmar URLs fuera del prefijo permitido. |

---

## Prerequisitos

| Requisito | Versión mínima | Verificación |
|---|---|---|
| Node.js | 22.x | `node -v` |
| pnpm | 9.x o superior | `pnpm -v` |
| Docker | 24.x | `docker --version` |
| Docker Compose | v2 (plugin oficial) | `docker compose version` |
| OpenSSL | 3.x (para generar secrets) | `openssl version` |
| Make (opcional) | — | los scripts compose se invocan vía `pnpm` o `docker compose` |

Para generar valores de secrets, ver [`configuration.md`](configuration.md).
Para arrancar el stack local, ver [`../structure/operations.md`](../structure/operations.md).

---

## Estructura de directorios (top-level)

```
express-clean-backend/
├── src/                             # Código TS
│   ├── domain/                      # Entidades, ports, errores, eventos
│   │   ├── auth/
│   │   ├── user/
│   │   ├── audit/
│   │   └── shared/                  # errors, events, logger, paginator,
│   │                                # response, slug, storage shared
│   ├── application/                 # Use-cases + Facades + Observers
│   │   ├── auth/
│   │   ├── user/
│   │   ├── storage/
│   │   └── audit/
│   ├── infrastructure/              # Adapters concretos
│   │   ├── mongodb/
│   │   ├── keycloak/
│   │   ├── services/s3/
│   │   ├── logger/
│   │   └── events/
│   ├── presentation/                # Routers, controllers, middlewares
│   │   ├── auth/
│   │   ├── user/
│   │   ├── storage/
│   │   └── bootstrap/               # app, server, error chain, middlewares
│   ├── config/                      # env Zod, swagger, database singleton
│   └── main.ts                      # Composition root
├── test/                            # Vitest specs (unit + integration)
├── infrastructure/                  # Plataforma compose
│   ├── traefik/
│   ├── keycloak/
│   ├── mongodb/
│   └── monitoring/
├── docs/                            # Esta documentación
├── package.json
├── tsconfig.json
├── compose.yaml
└── Dockerfile
```

Detalle por capa en [`architecture.md`](architecture.md).

---

## Siguientes pasos

- Para entender la arquitectura: [`architecture.md`](architecture.md).
- Para arrancar: [`../structure/operations.md`](../structure/operations.md) → Quick start.
