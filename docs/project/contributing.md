# Onboarding y contribución

Guía para nuevos contributors del backend Express 5 hexagonal.
Cubre setup primer día, code standards, code review checklist,
convenciones git/commits, y la regla de **sync docs↔código** que evita
el drift entre documentación y realidad.

---

## Indice

- [Setup primer dia](#setup-primer-dia)
- [Pre-requisitos](#pre-requisitos)
- [Code standards](#code-standards)
- [Path aliases](#path-aliases)
- [Code review checklist](#code-review-checklist)
- [Tests requeridos en PR](#tests-requeridos-en-pr)
- [Convenciones git y commits](#convenciones-git-y-commits)
- [Sync docs ↔ codigo](#sync-docs--codigo)
- [Tools diarios](#tools-diarios)
- [Que NO hacer (anti-patterns)](#que-no-hacer-anti-patterns)

---

## Setup primer dia

5 comandos copy-paste (resumen del workflow completo en
[11 — Operacion §"Quick start"](../structure/operations.md)):

```bash
# 1. Clonar
git clone <repo-url> express-clean-backend && cd express-clean-backend

# 2. Crear .env.local + secrets
cp .env.example .env.local
./scripts/generate-secrets.sh >> .env.local
./scripts/init-acme.sh

# 3. Levantar stack base + LocalStack
docker compose --profile dev up -d

# 4. Instalar deps + arrancar API
pnpm install
pnpm dev

# 5. Ejecutar tests
pnpm test
```

**Smoke test post-setup:**
- `curl http://localhost:3000/health/ready` → `{"status":"ok"}` con 200.
- `curl http://localhost:3000/api-docs` → HTML Swagger UI.

---

## Pre-requisitos

| Tool | Version minima | Notas |
|---|---|---|
| Node | `>=22.0.0` (`package.json:67`) | obligatorio (ESM nativo + features modernos) |
| pnpm | `>=9.x` | recomendado; `npm` funciona pero no es el flow primario |
| Docker Engine | reciente | runtime contenedores |
| Docker Compose | v2 | `docker compose ...` (no `docker-compose`) |
| OpenSSL | builtin macOS/Linux | usado por `scripts/generate-secrets.sh` |

Detalle completo en [11 — Operacion §"Pre-requisitos"](../structure/operations.md).

---

## Code standards

### Hexagonal estricto

Las capas internas (`domain/`, `application/`) no dependen de librerias de
infraestructura. Solo `infrastructure/` y `presentation/` pueden importar
clientes externos.

| Capa | Imports permitidos | Imports prohibidos |
|---|---|---|
| `src/domain/` | std lib, tipos propios | `mongoose`, `express`, `aws-sdk`, `keycloak`, `jose`, `winston`, `swagger-jsdoc` |
| `src/application/` | std lib, `domain/`, ports | mismos que `domain/` |
| `src/infrastructure/` | std lib + libs externas | logica de dominio |
| `src/presentation/` | std lib + Express + middlewares HTTP | clientes de Mongo/KC/S3 directos (usar ports) |

Verificacion local del invariante (debe devolver `0` lineas):

```bash
grep -rE "from '(mongoose|express|aws-sdk|keycloak|jose|winston)'" \
  src/domain src/application
```

### File size

- **<200 LOC por archivo** (regla CLAUDE.md global). La mayoria del repo
  ya esta <100 LOC.
- Si crece: extraer use-cases, helpers, schemas. Composicion sobre
  herencia.

### File naming

- **kebab-case obligatorio** para `.ts`, `.js`, `.sh`, `.py`.
- Nombres descriptivos largos > nombres cortos ambiguos:
  - ✅ `audit-login.observer.ts`
  - ✅ `get-signed-url.use-case.ts`
  - ❌ `observer.ts`, `signedUrl.ts`
- Sufijos por tipo:
  - `*.use-case.ts` — casos de uso application.
  - `*.repository.ts` — adapters Mongo.
  - `*.schema.ts` — schemas Mongoose.
  - `*.adapter.ts` — adapters infraestructura.
  - `*.middleware.ts` — middlewares Express.
  - `*.dto.ts` — schemas Zod.
  - `*.port.ts` — interfaces domain.
  - `*.entity.ts` — entidades planas.

### TypeScript

- **`strict: true`** obligatorio en `tsconfig.json` — **NUNCA** deshabilitar.
- ESM nativo (`"type": "module"` en `package.json:5`).
- Path aliases via `package.json:imports` (no `tsconfig.paths` exclusivo).

### Patrones obligatorios por capa

| Capa | Que ESTA permitido | Que NO esta permitido |
|---|---|---|
| Domain | entities planas, ports, DTOs Zod, errores base, eventos | imports de infra, side-effects en constructores |
| Application | use-cases (uno por archivo), facades, observers | tocar Mongo/Keycloak/S3 directamente; usar ports |
| Infrastructure | adapters de ports + libs externas | logica de dominio (NO calcular reglas de negocio aqui) |
| Presentation | routers, middlewares, error chain, DI por router | logica de UC inline en handlers |
| Config | Zod fail-fast, singletons, swagger jsdoc | imports de application/domain |

### Errores y respuestas

- **Errores via factories**: `CustomError.notFound(...)`, `CustomError.conflict(...)`,
  `CustomError.unauthorized(...)`, etc. NO `throw new Error('...')`.
- **Identidad por `keycloak_id`**, no por `_id` Mongo. Anti-IDOR + portabilidad
  BBDD.
- **`UserSchema.toJSON.transform`** drop `_id` y `__v` antes de enviar al
  cliente (verificado en `src/infrastructure/mongodb/schemas/user.schema.ts`).
- **DTOs Zod** en cada feature. Validar input HTTP, no confiar en `req.body`.

### Use-case por archivo

- Un UC = un archivo `.use-case.ts`.
- Un UC = una clase con metodo publico `execute(...)`.
- Composicion via `Facade` por feature
  (`AuthFacade`, `UserFacade`, `StorageFacade`).

---

## Path aliases

Definidos en `package.json:7-32` y replicados en `vitest.config.ts:16-25`.

| Alias | Resuelve a (dev) | Resuelve a (prod) |
|---|---|---|
| `#config/*` | `./src/config/*.ts` | `./dist/config/*.js` |
| `#domain/*` | `./src/domain/*.ts` | `./dist/domain/*.js` |
| `#application/*` | `./src/application/*.ts` | `./dist/application/*.js` |
| `#infrastructure/*` | `./src/infrastructure/*.ts` | `./dist/infrastructure/*.js` |
| `#presentation/*` | `./src/presentation/*.ts` | `./dist/presentation/*.js` |
| `#domain/shared/errors` | barrel (case especial) | barrel (case especial) |

**Imports recomendados:**
```ts
import { LoginUseCase } from '#application/auth/use-cases/login.use-case.js';
import { CustomError } from '#domain/shared/errors';
import type { LoggerPort } from '#domain/shared/logger/logger.port.js';
```

> Mantener extension `.js` en imports (ESM requirement, incluso para
> `.ts` source — TS lo resuelve correctamente).

---

## Code review checklist

Lista para reviewers (≤12 items, foco en high-leverage):

- [ ] **Hexagonal compliance**: no hay imports de `mongoose|express|aws|keycloak|jose|winston`
      en `src/domain/**` ni `src/application/**`.
- [ ] **File size <200 LOC** en archivos modificados/creados.
- [ ] **kebab-case** en filenames nuevos.
- [ ] **DTO Zod** para input HTTP de endpoints nuevos.
- [ ] **Errores via `CustomError.<status>`** factories, no `throw new Error`.
- [ ] **Sin `_id` Mongo** en respuestas (`toJSON.transform` lo elimina).
- [ ] **Use-case por archivo** si añade logica nueva en application.
- [ ] **Tests añadidos**: integration al menos para endpoint nuevo
      (excepcion storage hasta pregunta #32).
- [ ] **Sin AI references** en commits ni codigo (no `Co-Authored-By: Claude`).
- [ ] **Sin `.env*`** ni secrets en el diff (`git diff --cached | grep -i 'secret\|password'`).
- [ ] **Docs actualizadas**: si tocas `<area>`, actualizar `docs/<cap>` segun
      tabla §"Sync docs↔codigo".
- [ ] **Lint clean**: `pnpm lint` pasa.

---

## Tests requeridos en PR

### Reglas

- **Endpoint nuevo o modificado** → integration test obligatorio:
  - Caso 200 (happy path).
  - Caso 401/403 si requiere auth/rol.
  - Caso 400 si tiene Zod validation.
  - Caso 409 si puede colisionar (unique index).

- **Use-case con logica condicional** → unit test obligatorio cubriendo
  ramas (happy + cada error branch).

- **Adapter infra nuevo** → unit test si la logica del adapter es no
  trivial (parsing, mapping, retry). Para wrapping puro de SDK, integration
  basta.

### Excepciones documentadas

### Como añadir tests

- Plantillas integration y unit en
  [10 — Testing §"Como añadir un test"](testing/strategy.md).
- Helpers: `buildTestApp(iam)` y `FakeKeycloakAdapter.seed(...)`.

---

## Convenciones git y commits

### Conventional commits

Formato: `type(scope): description`

| Type | Cuando usar |
|---|---|
| `feat` | nueva feature visible al usuario |
| `fix` | bug fix |
| `docs` | solo docs (este capitulo, README, JSDoc) |
| `refactor` | reestructura sin cambio funcional |
| `test` | añadir/modificar tests |
| `chore` | tooling, deps, configuracion (no codigo de prod) |

**Ejemplos:**
```
feat(auth): add /auth/refresh endpoint with rotation
fix(user): handle 11000 dup error on POST /users
docs(testing): add integration test guide
refactor(infrastructure): split user.repository into command/query
test(audit): add unit test for AuditLoginObserver.onLoginFailed
chore(deps): bump vitest to 4.0.18
```

### Rules

- **Sin AI references**: NO `Co-Authored-By: Claude`, NO `🤖 Generated with`,
  NO menciones de modelo en mensajes.
- **PR title = commit title** del primer commit (CI/changelog lo usa).
- **No force-push a `main` o `master`**.
- **No commit directo a `main`** — siempre PR + review.

### Nombrado de ramas

```
<type>/<short-slug>
```

Ejemplos:
- `feat/auth-refresh-endpoint`
- `fix/user-create-409-handler`
- `docs/backend-es`
- `refactor/error-chain-extract-elog`

---

## Sync docs ↔ codigo

Regla obligatoria: **si tocas `<area>`, actualizas `docs/<cap>`**.

| Si tocas... | Actualiza... | Por que |
|---|---|---|
| `src/domain/**` o añades feature | `docs/project/features.md` | nueva entidad/UC visible al usuario |
| `src/application/**/use-cases/*.ts` | `docs/project/features.md` + matriz cobertura en `docs/project/testing/strategy.md` | UCs nuevos requieren test → matriz |
| `src/infrastructure/**` (adapter nuevo) | `docs/project/adapters.md` | nuevo adapter o cambio de port |
| `src/presentation/**/router.ts` con `@swagger` | `docs/api/reference.md` | endpoint nuevo en API publica |
| `src/config/env.ts` | `docs/project/configuration.md` (tabla `.env reference`) | nueva env var derivable mecanicamente |
| `docker-compose.yml` o `Dockerfile` | `docs/docker/platform.md` + `docs/structure/operations.md` | servicios o healthchecks |
| `monitoring/` (Prometheus, Grafana) | `docs/aws/observability.md` | metricas o dashboards |
| Añades issue de seguridad al código | `docs/project/security.md` | descripción de hardening |
| `package.json:scripts` | `docs/structure/operations.md` o `docs/project/contributing.md` | comandos visibles al operador/dev |
| `test/helpers/*` | `docs/project/testing/strategy.md` | helpers son parte de la API de tests |

**PR template sugerido** (incluir manualmente hasta automatizar):
```
## Cambios
<descripcion>

## Docs actualizadas
- [ ] He revisado la tabla "Sync docs↔codigo" y actualizado los caps relevantes.
- [ ] Si N/A: justifico aqui por que no aplica.
```

---

## Herramientas diarias

| Comando | Cuando |
|---|---|
| `pnpm dev` | desarrollo: tsx watch con `.env.local` (`package.json:34`) |
| `pnpm dev:staging` | smoke local pre-deploy con `.env.staging` (`package.json:36`) |
| `pnpm test` | antes de push: corre todo (`package.json:44`) |
| `pnpm test:watch` | TDD interactivo (`package.json:45`) |
| `pnpm test:unit` | feedback rapido en logica pura (`package.json:46`) |
| `pnpm test:integration` | requiere MongoMemoryServer (`package.json:47`) |
| `pnpm test:coverage` | reporte HTML en `coverage/` (`package.json:48`) |
| `pnpm lint` | pre-commit (`package.json:41`) |
| `pnpm lint:fix` | auto-fix lint (`package.json:42`) |
| `pnpm format` | prettier sobre `src/` y `test/` (`package.json:43`) |
| `pnpm build` | tsc → `dist/` (`package.json:37`) |

> Verificacion: scripts `compose:*` NO existen en `package.json`. Pregunta
> abierta #34. Documentar copy-paste de `docker compose --profile ...` en
> [11 — Operacion](../structure/operations.md).

### Pre-commit checklist

- [ ] `pnpm lint` clean.
- [ ] `pnpm test` pasa.
- [ ] No hay `.env*` en el `git diff --cached`.
- [ ] Mensaje de commit en formato conventional.
- [ ] Sin AI references en mensaje.


---

## Anti-patterns

Errores que invalidan un PR:

1. **NO importar `mongoose`/`express`/`aws-sdk`/`keycloak`/`jose`/`winston`
   en `src/domain/**` ni `src/application/**`.** Rompe hexagonal.

2. **NO crear archivos >200 LOC.** Si crece, splittea en helpers/UCs/schemas.

3. **NO commitear `.env*` reales.** `.gitignore` los excluye, pero
   `git add -A` puede colarse. Verificar `git status` antes de commit.

4. **NO commitear API keys, passwords, tokens.** Buscar antes de push:
   ```bash
   git diff --cached | grep -iE "(secret|password|token|api[_-]?key).*=.+"
   ```

5. **NO usar `JWT_SECRET` en produccion.** Es fallback HS256 dev/test.
   Producir SIEMPRE con RS256 contra Keycloak (`src/config/env.ts:51-56`).

6. **NO confiar en secrets de `keycloak/app-realm.json`** en staging/prod.
   Override con `KC_API_SECRET`, `KC_PANELS_SECRET` en `.env.<entorno>`.
   Detalle en [07 — Seguridad](security.md).

7. **Resolver issues de seguridad antes de producción.** Verificar en
   [07 — Seguridad](security.md).

8. **NO deshabilitar `strict: true`** en `tsconfig.json`. Regla CLAUDE.md
   global.

9. **NO usar CORS `*`** en produccion. `CORS_ORIGINS` es csv whitelist
   explicita (`src/config/env.ts:34-37`).

10. **NO almacenar passwords en texto plano.** Aqui el password lo gestiona
    Keycloak (Argon2/bcrypt). NUNCA hashear o guardar passwords en
    Mongo.

11. **NO hacer force-push a `main`/`master`.** Y nunca a otras branches
    sin avisar al owner.

12. **NO ignorar tests fallando** para pasar el build. Si un test es
    flaky, marcar como skip con un comentario explicativo + link a issue, no eliminarlo.

13. **NO añadir `Co-Authored-By: Claude`** ni `🤖 Generated with` ni
    referencias a modelos AI en commits.

---

## Ver tambien

- [10 — Testing](testing/strategy.md): plantillas integration/unit, matriz
  cobertura.
- [11 — Operacion](../structure/operations.md): quick start, healthchecks, runbook.
- [07 — Seguridad](security.md): hardening requerido antes de deploy.
- [08 — Configuracion](configuration.md): tabla `.env reference`.
