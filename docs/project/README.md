# Proyecto

## Qué

Esta carpeta documenta el ciclo de vida del desarrollo: ramas, convenciones de commits, code standards, estrategia de testing e integración continua desde commit hasta deployment.

## Por qué

Un equipo necesita reglas claras: cuándo crear rama, qué tipo de commit, quién revisa antes de merge, cómo se despliega. Sin esto, el código diverge y los PR se vuelven complicados de gestionar.

## Para qué

Acelerar onboarding de nuevos devs, reducir fricción en PR reviews, y automatizar deployments con confianza.

## En qué ayuda

- **Flujo claro**: feature → branch → test → PR → review → merge → deploy
- **Commits trazables**: Conventional Commits permiten auditoría y generación automática de changelogs
- **Standards unificados**: linting, formatting, JSDoc/TSDoc obligatorio
- **CI gates**: pre-commit hooks, pre-push tests, GitHub Actions checks
- **Deployment seguro**: manual approval en prod, rollback rápido si falla

## Qué hace

- Define estructura de branches (`main`, `staging`, `feature/*`, `fix/*`)
- Establece reglas de commit (Conventional Commits con scopes)
- Documenta proceso de PR (checklist, reviews requeridas)
- Especifica code standards (naming, errors, documentation)
- Detalla CI/CD pipeline (tests, linting, deployment gates)

## Estructura

| Archivo | Tema |
|---|---|
| [`README.md`](./README.md) | Este barrel (visión general) |
| [`workflow.md`](./workflow.md) | Git flow, branches, commits, PR checklist |
| [`testing/README.md`](./testing/README.md) | Estrategia testing, helpers, matriz cobertura |
| [`codebase.md`](./codebase.md) | Walkthrough técnico del codebase (arquitectura, patrones) |

## Stack visual

```
Node.js 22 LTS
    ↓
Express 5.2.1 (router, middleware)
    ↓
TypeScript 5.5.4 (compilation to ES2022)
    ↓
Zod 4.3.6 (schema validation + types)
    ↓
Mongoose 9.2 (MongoDB ODM, aggregations)
    ↓
Keycloak 26.6.1 + jose 6.1.3 (auth, JWT validation)
    ↓
Winston 3.19.0 + Loki 3.7.1 (logging)
    ↓
prom-client 15.1.3 (Prometheus metrics)
    ↓
AWS SDK v3 S3 (object storage)
```

## Decisiones arquitectónicas clave

| Decisión | Razón | Trade-off |
|---|---|---|
| **Hexagonal + DDD-lite** | Inversión de dependencias, testeable, agnóstico de frameworks | Más archivos, puede parecer excesivo para CRUD simple |
| **CQRS-lite repos** | Separación read/write, escalable | Extra abstracción comparado con Mongoose directo |
| **Facade per feature** | Single entry point, orquestación visible | Extra indirection |
| **Observer pattern (audit)** | Event-driven, non-blocking logging | Complejidad async |
| **Keycloak (no custom auth)** | Estándar OIDC, roles/perms centralizados | Infra para mantener (vs Firebase) |
| **Mongoose (no Prisma)** | Flexible aggregations, document-friendly | Menos type-safety que SQL ORMs |
| **Winston/Loki (no console.log)** | Structured logs, agregación, alertas | Extra dependency |

## Links relacionados

**Flat docs (legacy, pero autoridad):**
- [`docs/project/foundations.md`](./foundations.md) — stack, glosario, prerequisites
- [`docs/project/architecture.md`](./architecture.md) — Hexagonal deep-dive, patrones GoF
- [`docs/project/features.md`](./features.md) — auth, user, storage, audit features
- [`docs/api/reference.md`](../api/reference.md) — endpoints, schemas, error codes
- [`docs/project/adapters.md`](./adapters.md) — adapters (Mongo, Keycloak, S3, Winston)
- [`docs/project/testing/strategy.md`](./testing/strategy.md) — vitest setup, helpers, matriz de cobertura
- [`docs/project/contributing.md`](./contributing.md) — code standards, PR checklist

**New organized docs:**
- [`docs/docker/`](../docker/) — Docker Compose profiles (local, dev, prod)
- [`docs/api/`](../api/) — REST API reference + Swagger setup
- [`docs/gcp/`](../gcp/) — GCP services, pricing vs AWS
- [`docs/aws/`](../aws/) — AWS infrastructure (EC2, S3, RDS, etc.)

## Diagrama del workflow

```mermaid
flowchart LR
    F["feature/slug"]:::feature
    FIX["fix/slug"]:::fix
    STAGING["staging"]:::dev
    MAIN["main"]:::prod
    
    F -->|PR + review| STAGING
    FIX -->|PR + review| STAGING
    STAGING -->|merge on staging| STAGING_CI["staging CI<br/>tests + lint"]
    STAGING_CI -->|deploy| STAGING_ENV["staging env<br/>auto-deployed"]
    
    STAGING -->|PR to main| MAIN_PR["main PR<br/>requires 2 reviews"]
    MAIN_PR -->|approved + merge| MAIN
    MAIN -->|trigger| MAIN_CI["main CI<br/>full suite"]
    MAIN_CI -->|approved by| PROD["prod env<br/>manual deploy"]
    
    classDef feature fill:#7c3aed,stroke:#5b21b6,color:#fff
    classDef fix fill:#f59e0b,stroke:#d97706,color:#fff
    classDef dev fill:#3b82f6,stroke:#1e40af,color:#fff
    classDef prod fill:#dc2626,stroke:#7f1d1d,color:#fff
```

## Inicio rápido

1. Lee [`workflow.md`](./workflow.md) para entender el flujo de branches y commits.
2. Copia la checklist de PR de ese mismo archivo antes de crear un PR.
3. Para code standards, consulta [`codebase.md`](./codebase.md) y las reglas en `.claude/rules/jsdoc-tsdoc.md`.
4. Testing: lee [`testing/README.md`](./testing/README.md) y ejecuta `npm run test:coverage` antes de push.

## Convenciones

- **Branches**: `main` (production) | `staging` (development) | `feature/<slug>` (new feature) | `fix/<slug>` (bug fix)
- **Commits**: Conventional Commits con scopes: `feat(auth):`, `fix(user):`, `docs(api):`, etc.
- **Code style**: ESLint + Prettier. Ejecuta `npm run lint:fix && npm run format` antes de commit.
- **Documentation**: JSDoc/TSDoc en funciones/clases públicas. Sin comentarios inline.
- **Tests**: Vitest. Mínimo 75% cobertura. Antes de push: `npm run test` debe pasar.

## Diagramas

### Flujo de autenticación E2E (OIDC)
```mermaid
sequenceDiagram
    participant Client
    participant API as Express API
    participant KC as Keycloak
    participant JWT as JWT (jose)
    participant DB as MongoDB
    
    Client->>API: POST /auth/login (email, password)
    API->>KC: Validar contra Keycloak (OIDC)
    KC-->>API: accessToken + refreshToken
    API->>JWT: Validar JWT sig con JWKS
    JWT-->>API: claims extraídos (sub, email, roles)
    API->>DB: Buscar/crear usuario con keycloak_id
    DB-->>API: UserEntity
    API-->>Client: 200 OK + tokens + user profile
    
    Note over Client,API: Client almacena tokens en secure storage
    
    Client->>API: GET /api/v1/users (Bearer token)
    API->>API: JWT middleware valida
    API->>DB: Query con user_id
    DB-->>API: Resultado
    API-->>Client: 200 OK + data
```

### Pipeline CI/CD
```mermaid
stateDiagram-v2
    [*] --> Feature: git checkout feature/slug
    Feature --> PushFeature: git push origin feature/slug
    PushFeature --> FeatureCI: GitHub Actions: lint + test
    
    FeatureCI --> FeatureCIPass: ✓ Tests pass
    FeatureCI --> FeatureCIFail: ✗ Tests fail
    FeatureCIFail --> Feature: Fix code
    
    FeatureCIPass --> PR: Create PR → staging
    PR --> Review1: Review 1 / 2
    Review1 --> Review2: Review 2 / 2
    Review2 --> Approved: Approved
    
    Approved --> MergeStagingCI: Merge to staging<br/>GitHub Actions
    MergeStagingCI --> StagingDeploy: Auto-deploy staging env
    StagingDeploy --> StagingEnv: API live en staging.api.example.com
    
    StagingEnv --> PRMain: Create PR main<br/>requires 2 reviews
    PRMain --> ReviewMain: Reviewed
    ReviewMain --> ApprovedMain: Approved
    ApprovedMain --> MergeMain: Merge to main
    MergeMain --> MainCI: Full CI suite<br/>coverage, security scan
    MainCI --> ProdApproval: Manual approval needed
    ProdApproval --> ProdDeploy: Deploy production
    ProdDeploy --> Production: API live en api.example.com
    
    Production --> [*]
```

## Links relacionados

- Flat docs: [`docs/project/foundations.md`](./foundations.md) (stack, glosario)
- Flat docs: [`docs/project/architecture.md`](./architecture.md) (hexagonal, patrones)
- Flat docs: [`docs/project/contributing.md`](./contributing.md) (code standards legacy)
- Research: Conventional Commits 1.0.0 (especificación CC 1.0.0)
