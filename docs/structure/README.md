# Infraestructura

## What

Documentation for three deployment environments: local (localhost), development (EC2 staging), and production (EC2 production).

## Why

Each environment has different configuration (database, Keycloak URL, domain). Developers need to know where changes run and how they flow to production.

## Setup

Three separate environments let you:
- Reproduce production issues locally
- Test changes on staging before release
- Understand infrastructure layout
- Debug connectivity between services

## Included

- **Local:** Full stack in docker-compose, no AWS
- **Development:** Production-like setup on EC2 for testing
- **Production:** Real Let's Encrypt certificates and AWS integrations

Documentation covers:
- Components in each environment (API, database, proxy, monitoring)
- Environment variables
- Request flow (client → Traefik → API → database)
- Architecture diagrams

## Estructura

| Archivo | Tema |
|---|---|
| [`topology.md`](./topology.md) | **Mapa físico maestro** — qué corre dónde (EC2 mongo, ECS API, EC2 monitoring, S3 buckets, IAM, Firebase) |
| [`local.md`](./local.md) | Entorno local: API en host conectada a `mongo-staging` EC2 vía SSH tunnel |
| [`development.md`](./development.md) | Staging: ECS Fargate task `api-staging` + `mongo-staging` EC2 |
| [`production.md`](./production.md) | Production: ECS Fargate task `api-prod` + `mongo-prod` EC2 dedicada |

## Diagrama E2E: flujo de autenticación OIDC

```mermaid
sequenceDiagram
    participant Browser as Cliente<br/>(Browser)
    participant Traefik as Traefik<br/>(Reverse Proxy)
    participant API as Express API<br/>(Node.js)
    participant KC as Keycloak<br/>(OIDC Provider)
    participant Mongo as MongoDB<br/>(User Storage)
    participant S3 as AWS S3<br/>(Object Storage)
    
    Browser->>Traefik: GET /api/v1/users (sin token)
    Traefik->>Traefik: JWT middleware
    Traefik-->>Browser: 401 Unauthorized
    
    Browser->>Traefik: POST /api/v1/auth/login
    Traefik->>API: (forward to backend)
    API->>KC: Validar email + password (OIDC Client Credentials)
    KC-->>API: accessToken + refreshToken + keycloak_id
    API->>Mongo: Buscar/crear usuario con keycloak_id
    Mongo-->>API: UserEntity
    API->>API: Publicar LoginSuccessEvent
    API->>Mongo: AuditLoginObserver escucha y persiste
    Mongo-->>API: Audit log insertado
    API-->>Traefik: 200 { tokens, user }
    Traefik-->>Browser: 200 { tokens, user }
    
    Note over Browser: Cliente almacena accessToken
    
    Browser->>Traefik: GET /api/v1/users (Bearer token)
    Traefik->>Traefik: JWT middleware valida contra JWKS
    Traefik->>API: (forward con claims inyectados)
    API->>Mongo: Query usuarios
    Mongo-->>API: PaginatedResult
    API-->>Traefik: 200 { data, pagination }
    Traefik-->>Browser: 200 { data, pagination }
    
    Browser->>Traefik: POST /api/v1/storage/upload (presigned URL)
    Traefik->>API: GetSignedUrlUseCase
    API->>S3: GetObjectCommand con presigned signature
    S3-->>API: Presigned URL válida por 15 minutos
    API-->>Browser: 200 { url, expiration }
    
    Browser->>S3: PUT {presignedUrl} (sin auth)
    S3->>S3: Validar signature + timestamp
    S3-->>Browser: 200 OK (file uploaded)
```

## Componentes compartidos (todos los entornos)

| Componente | Tecnología | Puerto (local) | Propósito |
|---|---|---|---|
| **API** | Express 5 + TypeScript | 3000 | Backend HTTP |
| **MongoDB** | MongoDB 8.2 | 27017 | User data, audit logs |
| **Keycloak** | Keycloak 26.6.1 | 8080 | OIDC Provider, JWT |
| **Traefik** | Traefik 3.7 | 80, 443 | Reverse proxy + ACME |
| **Winston Logger** | Winston 3.19 | (stdout) | Logging |
| **Prometheus** | Prometheus 2.x | 9090 | Metrics scraping |
| **Grafana** | Grafana 11.x | 3001 | Dashboards |
| **Loki** | Loki 3.x | 3100 | Log aggregation |
| **AWS S3** | AWS SDK | (network) | Object storage |

## Envs por ambiente

| Variable | Local | Development | Production |
|---|---|---|---|
| `NODE_ENV` | `local` | `staging` | `production` |
| `DOMAIN` | N/A | `staging.api.example.com` | `api.example.com` |
| `KEYCLOAK_URL` | `http://localhost:8080` | `https://kc.staging.example.com` | `https://kc.example.com` |
| `MONGODB_URI` | `mongodb://localhost:27017/app` | EC2 private | EC2 private + auth |
| `AWS_S3_BUCKET` | `localstack` | `app-staging-bucket` | `app-prod-bucket` |
| `AWS_S3_REGION` | `us-east-1` | `us-east-1` | `us-east-1` |
| `LOKI_URL` | `http://localhost:3100` | `http://loki:3100` | `http://loki-prod:3100` |

## Diagramas por entorno

### Local (docker-compose dev profile)
```mermaid
flowchart TB
    Client["Client<br/>(localhost:3000)"]
    
    subgraph Docker["Docker Compose (dev)"]
        Traefik["Traefik 3.7<br/>:80, :443"]
        API["Express API<br/>:3000"]
        Mongo["MongoDB<br/>:27017"]
        KC["Keycloak<br/>:8080"]
        Prom["Prometheus<br/>:9090"]
        Grafana["Grafana<br/>:3001"]
        Loki["Loki<br/>:3100"]
    end
    
    LocalStack["LocalStack<br/>(S3 fake)<br/>:4566"]
    
    Client -->|HTTP| Traefik
    Traefik -->|forward| API
    API -->|query| Mongo
    API -->|auth| KC
    API -->|metrics| Prom
    API -->|logs| Loki
    API -->|presigned| LocalStack
    Prom -->|scrape| API
    Grafana -->|read| Prom
    Grafana -->|read| Loki
    
    style Docker fill:#e3f2fd
    style Client fill:#fff3e0
```

### Development (EC2 staging)
```mermaid
flowchart TB
    Internet["Internet"]
    
    subgraph EC2Dev["EC2 t.micro (staging)"]
        Traefik["Traefik 3.7<br/>ACME LE<br/>:80, :443"]
        API["Express API<br/>:3000"]
        Mongo["MongoDB 8.2<br/>:27017 (container)"]
        Prom["Prometheus<br/>:9090"]
        Loki["Loki<br/>:3100"]
    end
    
    KeycloakProd["Keycloak prod<br/>(shared)"]
    S3["AWS S3<br/>(prod bucket)"]
    
    Internet -->|https://staging.api.example.com| Traefik
    Traefik -->|forward| API
    API -->|query| Mongo
    API -->|auth| KeycloakProd
    API -->|metrics| Prom
    API -->|logs| Loki
    API -->|presigned| S3
    Prom -->|scrape| API
    
    style EC2Dev fill:#f3e5f5
    style KeycloakProd fill:#fff3e0
    style S3 fill:#fff3e0
```

### Production (EC2 prod)
```mermaid
flowchart TB
    Internet["Internet<br/>(Público)"]
    
    subgraph EC2Prod["EC2 t.micro (production)"]
        Traefik["Traefik 3.7<br/>ACME LE<br/>:80, :443"]
        API["Express API<br/>:3000"]
        Mongo["MongoDB 8.2<br/>:27017 (container)"]
        Prom["Prometheus<br/>:9090"]
        Loki["Loki<br/>:3100"]
    end
    
    KeycloakProd["Keycloak prod<br/>(shared)"]
    S3["AWS S3<br/>(prod bucket)"]
    BackupS3["AWS S3<br/>(backups)"]
    
    Internet -->|https://api.example.com| Traefik
    Traefik -->|forward| API
    API -->|query| Mongo
    API -->|auth| KeycloakProd
    API -->|metrics| Prom
    API -->|logs| Loki
    API -->|presigned| S3
    Mongo -->|mongodump| BackupS3
    
    style EC2Prod fill:#e8f5e9
    style KeycloakProd fill:#fff3e0
    style S3 fill:#fff3e0
    style BackupS3 fill:#ffccbc
```

## Flujo de deployment

```mermaid
stateDiagram-v2
    [*] --> Dev: npm run dev<br/>(local)
    
    Dev --> Feature: git checkout feature/slug
    Feature --> Test: npm test
    Test --> Push: git push origin feature/slug
    
    Push --> StagingCI: GitHub Actions<br/>(staging branch)
    StagingCI --> StagingDeploy: Tests pass
    StagingDeploy --> StagingEnv: ECS/EC2 deploy
    StagingEnv --> StagingQA: QA testing
    
    StagingQA --> MainPR: Create PR main
    MainPR --> MainReview: 2 code reviews
    MainReview --> MainMerge: Approved
    MainMerge --> MainCI: Full CI suite
    MainCI --> ProdApproval: Manual approval needed
    ProdApproval --> ProdDeploy: ECS/EC2 deploy
    ProdDeploy --> ProdEnv: Live in production
    ProdEnv --> Monitor: Prometheus + Loki
    Monitor --> [*]
```

## Links relacionados

- Docker Compose detail: [`docs/docker/`](../docker/)
- AWS infrastructure: [`docs/aws/`](../aws/)
- Keycloak setup: [`docs/gcp/firebase/`](../gcp/firebase/)
- API endpoints: [`docs/api/reference.md`](../api/reference.md)
- Full infra docs: [`docs/project/adapters.md`](../project/adapters.md)
- Traefik overview: Traefik 3.7 docs oficiales
