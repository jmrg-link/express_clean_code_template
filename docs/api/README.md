# API

> Express 5 REST API with OpenAPI/Swagger. Base path: `/api/v1`. Authentication: Bearer JWT via Keycloak.

## What

Reference for REST endpoints, request/response schemas, error codes, and auto-generated OpenAPI docs from JSDoc.

## Why

A clear API needs living documentation. You need to know:
- What each endpoint does
- What parameters it accepts
- What status codes and data it returns
- How to authenticate (Bearer JWT)

Without this, frontend and mobile integrations are guesswork.

## Setup

- New developers discover endpoints quickly
- Frontend teams know exactly which parameters to pass
- Error cases are documented
- CI/CD can validate API changes in PRs
- Mobile teams can generate SDKs from OpenAPI

## Features

- **Interactive:** Swagger UI at `/api/v1/docs` (live, testable)
- **Type-safe:** Zod schemas in code handle validation and types
- **Automated:** JSDoc `@swagger` blocks generate OpenAPI JSON
- **Discoverable:** Full endpoint list with methods, paths, auth requirements

## Estructura

| Archivo | Tema |
|---|---|
| [`README.md`](./README.md) | Este barrel (visión general) |
| [`reference.md`](./reference.md) | Tabla completa de endpoints + schemas |
| [`reference.md`](./reference.md) | Documentación detallada (legacy) |
| [`../project/adapters.md`](../project/adapters.md) | Integración Keycloak, JWT, validación |

## Quick start

**Local (desarrollo):**
```bash
npm run dev:local
# Swagger UI: http://localhost:3000/api/v1/docs
# Raw spec: http://localhost:3000/api/v1/spec
```

**Staging/Production:**
```
Swagger: https://api.staging.example.com/api/v1/docs
Spec: https://api.staging.example.com/api/v1/spec
```

## Diagrama: Request lifecycle

```mermaid
flowchart LR
    Client["Cliente<br/>(web/mobile)"]
    Traefik["Traefik<br/>reverse proxy<br/>security-headers<br/>ratelimit"]
    Express["Express app<br/>CORS middleware"]
    Auth["JWT auth<br/>middleware<br/>Bearer token"]
    Router["Router<br/>(auth, user, etc.)"]
    Validation["Zod validation<br/>request body/query"]
    UseCase["Use case<br/>(business logic)"]
    Repo["Repository<br/>(MongoDB Mongoose)"]
    Response["Response<br/>standardized envelope<br/>201, 400, 401, etc."]
    
    Client -->|POST /api/v1/auth/login<br/>Content-Type: application/json| Traefik
    Traefik -->|add X-Forwarded-* headers| Express
    Express -->|CORS check<br/>origin whitelist| Auth
    Auth -->|extract Bearer token<br/>validate JWT| Router
    Router -->|route to handler| Validation
    Validation -->|parse + validate| UseCase
    UseCase -->|read/write| Repo
    Repo -->|Mongoose query| Response
    Response -->|200, 400, 401, 500<br/>JSON envelope| Client
    
    style Client fill:#7c3aed
    style Traefik fill:#3b82f6
    style Auth fill:#f59e0b
    style Validation fill:#06b6d4
    style UseCase fill:#10b981
    style Repo fill:#8b5cf6
```

## Base path y versioning

**Current:** `v1`

```
/api/v1/auth/login       → authentication
/api/v1/users            → user management
/api/v1/storage          → S3 operations
/api/v1/health           → health checks
/api/v1/metrics          → Prometheus metrics
```

**Future versioning strategy:**
- API v2: breaking changes → `/api/v2`
- Mantener v1 por 2-3 meses (deprecation warning)
- Clients migran vía header `API-Version: v2` (opcional)

## Response format estándar

Todas las respuestas siguen envoltura:

```json
{
  "statusCode": 200,
  "message": "User created",
  "data": {
    "id": "user_id_123",
    "email": "user@example.com",
    "role": "user"
  },
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 42,
    "pages": 5
  }
}
```

**Campos:**
- `statusCode` (number): HTTP status code
- `message` (string): descripción legible
- `data` (object | array): payload (puede faltar si error)
- `pagination` (object): solo en GET list; faltar si no aplica

### Errores

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [
      {
        "path": "email",
        "message": "Invalid email format"
      }
    ]
  }
}
```

**Campos:**
- `statusCode`: HTTP code (400, 401, 404, 500, etc.)
- `message`: descripción short
- `error.code`: código máquina (para frontend switches)
- `error.details`: array de validation errors (si aplica)

## Status codes y error codes

| HTTP | Code | Descripción | Cuándo |
|---|---|---|---|
| **200** | OK | Request exitoso | GET success, HEAD success |
| **201** | CREATED | Recurso creado | POST success |
| **204** | NO_CONTENT | Borrado/actualización | DELETE success, PATCH sin body |
| **400** | VALIDATION_ERROR | Payload inválido | Email format, required fields |
| **401** | UNAUTHORIZED | Token faltante/inválido | Bearer token expirado, malformado |
| **403** | FORBIDDEN | Permisos insuficientes | User role != admin |
| **404** | NOT_FOUND | Recurso no existe | GET /users/invalid-id |
| **409** | DUPLICATE_RESOURCE | Email/unique constraint | Email ya registrado |
| **429** | RATE_LIMIT | Demasiados requests | > 100 req/min |
| **500** | INTERNAL_SERVER_ERROR | Unexpected error | DB crash, service error |

## Autenticación

### Bearer JWT (Keycloak)

```bash
# 1. Login (get token)
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'

# Response
{
  "statusCode": 200,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "...",
    "user": { "id": "...", "email": "...", "role": "user" }
  }
}

# 2. Use token
curl http://localhost:3000/api/v1/users \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."

# Response
{
  "statusCode": 200,
  "data": [{ "id": "...", "email": "...", "role": "user" }],
  "pagination": { "page": 1, "limit": 10, "total": 1, "pages": 1 }
}

# 3. Token expirado
curl http://localhost:3000/api/v1/users \
  -H "Authorization: Bearer eyJhbGc..."  # expired

# Response
{
  "statusCode": 401,
  "message": "Token expired",
  "error": { "code": "UNAUTHORIZED", "details": null }
}
```

**Implementación:**
- Token firma: Keycloak con private key (RS256)
- Validation: API valida con JWKS public key
- Extracción: JWT middleware lee `Authorization: Bearer <token>`
- Claims: sub (user_id), email, roles extraídos del JWT

## Rate limiting

**Global:** 100 req/min por IP (Traefik middleware)

```bash
# Normal request
curl http://localhost:3000/api/v1/users
# 200 OK

# After 100 requests/min
curl http://localhost:3000/api/v1/users
# 429 RATE_LIMIT
# Header: Retry-After: 60 (espera 60 segundos)
```

## Endpoints principales

### Auth
- `POST /api/v1/auth/login` — login con email/password
- `POST /api/v1/auth/register` — registro new user
- `POST /api/v1/auth/refresh-token` — refresh expired token
- `GET /api/v1/auth/me` — perfil actual (auth required)

### Users
- `GET /api/v1/users` — list (paginated, admin required)
- `GET /api/v1/users/:id` — detalle by ID
- `POST /api/v1/users` — create (admin required)
- `PATCH /api/v1/users/:id` — update profile
- `DELETE /api/v1/users/:id` — soft delete

### Storage
- `GET /api/v1/storage/presigned-url` — S3 presigned URL
- `GET /api/v1/storage/objects` — list S3 objects
- `POST /api/v1/storage/upload` — initiate multipart upload

### Health
- `GET /api/v1/health/live` — liveness (always 200)
- `GET /api/v1/health/ready` — readiness (200 if DB connected)

### Metrics
- `GET /api/v1/metrics` — Prometheus metrics (plain text)

Ver [`reference.md`](./reference.md) para detalles completos.

## Testing endpoints

**Postman / Insomnia:**
1. Import OpenAPI spec: `http://localhost:3000/api/v1/spec`
2. Todos los endpoints + ejemplos se cargan automáticamente

**cURL:**
```bash
# Crear usuario (admin)
curl -X POST http://localhost:3000/api/v1/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "new@example.com", "password": "password123", "name": "New User"}'
```

**Node.js / Fetch:**
```javascript
const response = await fetch('http://localhost:3000/api/v1/users', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const { statusCode, data, error } = await response.json();
```

## Swagger / OpenAPI

### Configuración

**Ubicación:** `src/presentation/swagger/config.ts`

```typescript
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Express Clean Backend API',
      version: '1.0.0'
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local' },
      { url: 'https://api.staging.example.com', description: 'Staging' },
      { url: 'https://api.example.com', description: 'Production' }
    ]
  },
  apis: ['src/presentation/routers/*.ts']
});
```

### JSDoc convention

```typescript
/**
 * @swagger
 * /api/v1/users:
 *   get:
 *     summary: List users (paginated)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode: { type: integer }
 *                 data: { type: array }
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticate, listUsers);
```

### Endpoints automáticos

Se generan en tiempo de build (`npm run build`):

1. JSDoc leído de routers
2. swagger-jsdoc parsea `@swagger` blocks
3. OpenAPI JSON generado en `/api/v1/spec`
4. swagger-ui-express expone en `/api/v1/docs`

## Referencias

- Spec OpenAPI: `/api/v1/spec` (machine-readable)
- Docs interactivos: `/api/v1/docs` (Swagger UI)
- Legacy flat docs: [`reference.md`](./reference.md)
- Swagger config: `src/presentation/swagger/config.ts`
- Routers: `src/presentation/routers/`
