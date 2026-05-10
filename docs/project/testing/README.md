# Testing

## Qué

Estrategia, herramientas y casos de test para express-clean-backend. Cobertura ~75% usando Vitest sin mocks de BD (in-memory server).

## Por qué

Tests verifican que la lógica funciona antes de merge. Sin tests, cambios rompen código silenciosamente. Cobertura alta significa menos bugs en producción.

## Para qué

- Verificar use-cases, adapters, y flujos de integración
- Bloquear merge en GitHub si tests fallan
- Detectar regresiones antes de deployment
- Documentar comportamiento esperado

## En qué ayuda

- **Confianza:** merge con tests pasando = código funciona
- **Regresiones:** nuevos cambios no rompen viejo
- **Documentación viva:** test = especificación ejecutable
- **Refactoring seguro:** cambios internos no afectan tests
- **Coverage metric:** rastrear qué código está cubierto

## Qué hace

- Define estructura `test/unit`, `test/integration`
- Especifica helpers para mocks (fake adapters)
- Documenta matriz de cobertura por feature
- Incluye setup (mongodb-memory-server auto)
- Proporciona comandos npm para ejecutar tests

## Estructura

```
test/
├── unit/                              # Tests unitarios, sin BD
│   ├── custom-error.spec.ts          # Error class behavior
│   ├── event-bus.spec.ts             # EventBus pub/sub
│   ├── paginator.spec.ts             # Pagination logic
│   ├── slugger.spec.ts               # URL slug generation
│   ├── get-signed-url.spec.ts        # S3 presigned logic
│   ├── list-storage-objects.spec.ts  # S3 list logic
│   └── request-context-logger.spec.ts # Request-scoped logging
├── integration/                       # Tests integrales, con BD en-memory
│   ├── auth.integration.spec.ts      # Login, register, refresh flow
│   └── users.integration.spec.ts     # User CRUD, paginación, soft delete
├── helpers/                           # Utilidades de testing
│   ├── build-test-app.ts            # Instancia Express para tests
│   ├── fake-keycloak.adapter.ts      # Mock Keycloak (login siempre OK)
│   ├── fake-storage.adapter.ts       # Mock S3 (presigned URLs fake)
│   └── README.md
└── setup.ts                           # Vitest config, mongodb-memory-server lifecycle
```

## Comando rápido

```bash
# Run all tests
npm run test

# Watch mode (rerun on file change)
npm run test:watch

# Only unit tests
npm run test:unit

# Only integration tests
npm run test:integration

# Coverage report
npm run test:coverage
```

## Matriz de cobertura

| Feature | Archivos | Unit | Integration | Coverage |
|---|---|---|---|---|
| **Auth** | login, register, refresh, get-me use-cases | ✓ (mocks) | ✓ (real flow) | 85% |
| **User** | CRUD use-cases, soft delete, pagination | ✓ (mocks) | ✓ (real flow) | 80% |
| **Storage** | Presigned URLs, list objects | ✓ (mocks) | Parcial | 70% |
| **Audit** | Observer, event listener | ✓ (unit) | ✓ (event flow) | 75% |
| **Error chain** | Handler base, middleware chain | ✓ (unit) | ✓ (E2E) | 80% |
| **Logger** | Winston adapter, request context | ✓ (unit) | ✓ (injection) | 75% |
| **Paginator** | Offset/limit logic | ✓ (unit) | ✓ (queries) | 90% |

**Promedio:** ~75%

## Cómo escribir un test unitario

**Ubicación:** `test/unit/{feature}.spec.ts`

**Template:**
```typescript
import { describe, it, expect } from 'vitest';
import { Slugger } from '#domain/shared/slug/slugger';

describe('Slugger', () => {
  it('generates URL-safe slug from string', () => {
    const slugger = new Slugger();
    const result = slugger.generate('Hello World!');
    expect(result).toBe('hello-world');
  });

  it('removes special characters', () => {
    const slugger = new Slugger();
    const result = slugger.generate('Test@123#Slug');
    expect(result).toBe('test123slug');
  });

  it('handles empty string', () => {
    const slugger = new Slugger();
    const result = slugger.generate('');
    expect(result).toBe('');
  });
});
```

**Patrón:** Arrange → Act → Assert (AAA)
```typescript
it('description of what it does', () => {
  // Arrange: setup
  const slugger = new Slugger();
  const input = 'Hello World';

  // Act: execute
  const result = slugger.generate(input);

  // Assert: verify
  expect(result).toBe('hello-world');
});
```

## Cómo escribir un test de integración

**Ubicación:** `test/integration/{feature}.integration.spec.ts`

**Template (Auth login):**
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/build-test-app';
import type { Express } from 'express';

describe('Auth Integration', () => {
  let app: Express;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close?.();
  });

  it('POST /api/v1/auth/login returns 200 with tokens', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123',
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('tokens.accessToken');
    expect(response.body).toHaveProperty('user.email', 'test@example.com');
  });

  it('POST /api/v1/auth/login returns 400 on invalid payload', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-email' }); // Missing password

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  it('GET /api/v1/users with Bearer token returns 200', async () => {
    // First login
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });

    const token = loginRes.body.tokens.accessToken;

    // Then access protected endpoint
    const response = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('GET /api/v1/users without token returns 401', async () => {
    const response = await request(app).get('/api/v1/users');

    expect(response.status).toBe(401);
  });
});
```

## Helpers: buildTestApp

**Ubicación:** `test/helpers/build-test-app.ts`

```typescript
import { App } from '#presentation/bootstrap/app';
import { buildDependencies } from '#presentation/bootstrap/dependencies';

export async function buildTestApp(): Promise<Express> {
  // Override adapters con fakes
  const deps = buildDependencies({
    keycloakAdapter: new FakeKeycloakAdapter(),
    storageAdapter: new FakeS3Adapter(),
  });

  return App.create(deps);
}
```

**Propósito:** Aislar tests de servicios externos (Keycloak, S3). Tests corren rápido sin HTTP calls.

## Helpers: Fake adapters

### FakeKeycloakAdapter

**Ubicación:** `test/helpers/fake-keycloak.adapter.ts`

```typescript
export class FakeKeycloakAdapter implements IamPort {
  async login(email: string, password: string) {
    // Siempre retorna OK para testing
    return {
      accessToken: 'fake-jwt-' + email,
      refreshToken: 'refresh-' + email,
      keycloak_id: 'kc_' + email.split('@')[0],
    };
  }

  async validateToken(token: string) {
    if (!token.startsWith('fake-jwt-')) throw new Error('Invalid token');
    return {
      sub: 'kc_test',
      email: 'test@example.com',
      roles: ['user'],
    };
  }
}
```

### FakeS3Adapter

**Ubicación:** `test/helpers/fake-storage.adapter.ts`

```typescript
export class FakeS3Adapter implements StoragePort {
  async getPresignedUrl(operation: 'GET' | 'PUT' | 'DELETE', key: string) {
    return `https://s3-fake.example.com/${key}?signature=fake`;
  }

  async listObjects(prefix: string) {
    return {
      contents: [
        { key: prefix + 'file1.txt', size: 1024 },
        { key: prefix + 'file2.txt', size: 2048 },
      ],
    };
  }
}
```

## Setup de tests (Vitest config)

**Ubicación:** `test/setup.ts`

```typescript
import { beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  // Conectar Mongoose aquí
});

afterAll(async () => {
  await mongoServer.stop();
});
```

**Propósito:** Cada test suite tiene BD en-memory limpia. Sin configurar `localhost:27017`.

## Cobertura y thresholds

**`vitest.config.ts`:**
```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        '**/*.spec.ts',
      ],
      lines: 75,        // Mínimo 75% líneas
      functions: 75,    // Mínimo 75% funciones
      branches: 70,     // Mínimo 70% branches
      statements: 75,   // Mínimo 75% statements
    },
  },
});
```

**Ejecutar:**
```bash
npm run test:coverage
```

**Output:** `coverage/index.html` → abrir en browser

## Flujo típico: escribir nuevo feature

1. **Escribir test primero** (TDD)
   ```bash
   npm run test:watch
   ```
   Test falla (red)

2. **Implementar feature** en `src/`
   Test pasa (green)

3. **Refactor** si es necesario (ambos pasan)

4. **Run full suite antes de push**
   ```bash
   npm run test
   npm run test:coverage
   ```

5. **Commit con test passing**
   ```bash
   git commit -m "feat(user): add profile endpoint"
   ```

## Errores comunes

| Error | Causa | Solución |
|---|---|---|
| `Cannot find module '#domain/...'` | Path alias no configurado | Verificar `tsconfig.json` + `vitest.config.ts` |
| `MONGODB_URI not set` | Setup.ts no ejecutó | Check `setupFiles` en vitest.config.ts |
| `FakeKeycloakAdapter is not defined` | Import faltante | `import { FakeKeycloakAdapter } from '../helpers/...'` |
| `timeout exceeded` | BD no responde | mongodb-memory-server no started; revisar afterAll |
| `Test pass local, fail in CI` | Env var differences | Verificar CI workflow vars (GitHub Secrets) |

## Debugging tests

### Local

```bash
# Run single test file
npm run test test/unit/slugger.spec.ts

# Run tests matching pattern
npm run test -- --reporter=verbose auth

# Watch + rerun on change
npm run test:watch
```

### En VS Code

Instalar "Vitest" extension, luego debug icon al lado de `describe/it`.

### En CI (GitHub Actions)

Logs están en GitHub → Actions → workflow run → test job.

## Exclusiones de cobertura

Si una rama es imposible de alcanzar:

```typescript
// Without this check, fakeAdapter throws
/* v8 ignore next 2 */
if (!token) {
  throw new UnauthorizedError('Missing token');
}
```

**Uso sparingly.** Prefiere refactor para hacerlo testeable.

## Mejores prácticas

| Práctica | Razón |
|---|---|
| **Describe nested** | Agrupa tests por feature, readable |
| **Usar factories** | `buildTestApp()` no repite setup |
| **Fail fast** | 1 assert por test ideal; máximo 3 |
| **Test behavior, no impl** | Si refactoras, tests no cambian |
| **Mocks ≠ stubs** | Mocks verify calls; stubs return data |
| **Sin hardcoded IDs** | Usar fixtures generadas |
| **Async/await** | No promises en tests |

## Referencias

- Vitest docs: https://vitest.dev/
- Supertest docs: https://github.com/visionmedia/supertest
- mongodb-memory-server: https://github.com/typegoose/mongodb-memory-server
- Flat testing docs: [`docs/project/testing/strategy.md`](../.strategy.md)
