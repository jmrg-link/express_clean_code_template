# Operación

Runbook operativo del backend Express 5: arranque, healthchecks, graceful
shutdown, despliegue por entorno, troubleshooting y respuesta a
incidentes.

Para detalles de plataforma (Traefik, redes, volúmenes) ver
[Plataforma + Deploy](../docker/platform.md). Para observabilidad (logs,
métricas) ver [Observabilidad](../aws/observability.md).

---

## Indice

- [Pre-requisitos](#pre-requisitos)
- [Quick start (arranque local)](#quick-start-arranque-local)
- [Perfiles docker-compose](#perfiles-docker-compose)
- [Healthchecks](#healthchecks)
- [Bootstrap secuencia](#bootstrap-secuencia)
- [Graceful shutdown](#graceful-shutdown)
- [Despliegue por entorno](#despliegue-por-entorno)
- [Troubleshooting](#troubleshooting)
- [Runbook de incidentes](#runbook-de-incidentes)

---

## Pre-requisitos

| Tool | Version | Uso |
|---|---|---|
| Node | `>=22.0.0` (`package.json:67`) | runtime, `tsx`, `vitest` |
| pnpm | recomendado | install deps; alternativa: `npm` (Dockerfile usa `npm ci`) |
| Docker Engine | reciente | runtime contenedores |
| Docker Compose | v2 (`docker compose`, no `docker-compose`) | perfiles requieren v2 |
| OpenSSL | bash builtin macOS/Linux | `scripts/generate-secrets.sh` |
| Make | opcional | no hay `Makefile` en el repo |

---

## Inicio rápido (arranque local)

Workflow end-to-end derivado de los `scripts/*.sh` y los perfiles compose.

```bash
# 1. Clonar
git clone <repo-url> express-clean-backend && cd express-clean-backend

# 2. Crear .env.local desde el example
cp .env.example .env.local

# 3. Generar secrets (OIDC plugin, KC clients, JWT, Grafana, Traefik basicauth)
./scripts/generate-secrets.sh >> .env.local

# 4. Inicializar ACME (crea data/traefik/acme/acme.json con chmod 600)
./scripts/init-acme.sh

# 5. Levantar stack base + LocalStack (perfil dev)
docker compose --profile dev up -d

# 6. (Opcional) Levantar stack observability
docker compose --profile observability up -d

# 7. Instalar deps de la API
pnpm install

# 8. Arrancar API en host con hot-reload (consume .env.local)
pnpm dev
```

Tras arrancar:

- API: `http://localhost:${PORT}` (default `3000`).
- Swagger UI: `http://localhost:${PORT}/api-docs`.
- Healthcheck: `http://localhost:${PORT}/health/ready`.
- Keycloak: `https://auth.${DOMAIN}` (via Traefik) o `http://localhost:8080`.
- Grafana (si profile observability): `https://grafana.${DOMAIN}` (login via
  plugin OIDC Traefik).

---

## Perfiles docker-compose

Definidos en `docker-compose.yml`. Verificado por researcher-02:

| Perfil | Servicios incluidos | Uso |
|---|---|---|
| `(default)` (sin `--profile`) | `traefik` + `mongodb` + `keycloak` + `api` | base de produccion |
| `dev` | `(default)` + `localstack` | desarrollo local con S3 emulado |
| `observability` | `loki` + `grafana` + `prometheus` | metricas + logs + dashboards |

Los perfiles son combinables:

```bash
docker compose --profile dev --profile observability up -d
```

Servicios fuera de perfil arrancan siempre. Servicios dentro de un perfil
solo arrancan si su perfil esta activo.

---

## Healthchecks

La API expone tres endpoints de health (`src/presentation/bootstrap/app.ts:60-74`):

| Endpoint | Logica | Status codes | Uso |
|---|---|---|---|
| `GET /health/live` | `process.uptime()` | `200` siempre | liveness K8s / Traefik (¿el proceso responde?) |
| `GET /health/ready` | `MongoDatabase.isHealthy()` | `200` healthy / `503` unhealthy | readiness K8s (¿lista para trafico?) |
| `GET /health` | `process.uptime()` | `200` siempre | smoke test raiz |

`MongoDatabase.isHealthy()` (`src/config/database.ts:11-31`) hace
`mongoose.connection.db.admin().ping()` con timeout. Si Mongo no responde
o no esta conectado, devuelve `false` → `/health/ready` responde `503`.

---

## Bootstrap secuencia

`src/main.ts:34-77` define el orden deterministico de inicializacion:

1. **Logger** (`WinstonLoggerAdapter.create()`, `main.ts:36`).
2. **EventBus** (`InMemoryEventBus`, `main.ts:44`).
3. **AuditObserver** suscrito al EventBus (`main.ts:47-49`).
4. **IAM adapter** (`KeycloakAdapter`, `main.ts:52`).
5. **JwtMiddleware** (depende de `IamPort`, `main.ts:55`).
6. **S3 adapter** (opcional — solo si `env.s3.isConfigured`,
   `main.ts:58-65`).
7. **Routers** por feature (cada uno con su DI local, `main.ts:68-72`).
8. **App + Server** (`main.ts:73-76`):
   - `Server.start()` (`server.ts:23-39`):
     - `MongoDatabase.connect()` (await — fail-fast si Mongo no responde).
     - `expressApp.listen(port, host, callback)`.
     - `bindShutdownSignals()`.

Si cualquier paso falla, `main.ts:79-83` captura, hace `console.error` y
`process.exit(1)`. **No degraded mode**: arranque atomico.

> Diagrama de bootstrap detallado: ver
> [02 — Arquitectura §"Composition root"](../project/architecture.md).

---

## Graceful shutdown

`src/presentation/bootstrap/server.ts:48-77` registra handler para
`SIGTERM` y `SIGINT`:

| Paso | Codigo | Que hace |
|---|---|---|
| 1 | `server.ts:56-58` | `shuttingDown = true` (idempotente: segunda señal ignorada) |
| 2 | `server.ts:59` | log warn `Received <signal>, starting graceful shutdown` |
| 3 | `server.ts:61-65` | `setTimeout(10_000).unref()` — fuerza `exit(1)` si pasa 10s |
| 4 | `server.ts:68` | `httpServer.close()` (deja terminar in-flight, rechaza nuevas) |
| 5 | `server.ts:70` | `MongoDatabase.disconnect()` (cierra pool) |
| 6 | `server.ts:72` | `process.exit(0)` |

**Timeout 10s con `.unref()`**: el timeout no bloquea el event loop una
vez registrado. Si el shutdown completa antes, sale con `exit(0)`. Si pasa
10s sin completar, sale con `exit(1)` y el orquestador puede investigar.

**Implicaciones operativas:**
- Kubernetes `terminationGracePeriodSeconds` debe ser **>= 15s** (10s
  shutdown + margen) para no recibir SIGKILL prematuro.
- Connections HTTP en curso terminan limpiamente.
- Si Mongo esta caido al recibir SIGTERM, `disconnect()` puede colgar →
  el timeout fuerza salida.

---

## Despliegue por entorno

### Local

```bash
docker compose --profile dev up -d   # base + LocalStack
pnpm dev                              # API en host con tsx watch
```

- `NODE_ENV=local`, lee `.env.local`.
- Logger Winston en formato `colorize+printf`.
- Loki transport **deshabilitado** (`src/infrastructure/logger/winston.adapter.ts:43-58`
  — solo en staging/production con `LOKI_HOST`).
- LocalStack S3 emulado (`AWS_S3_ENDPOINT=http://localstack:4566`).

### Staging

```bash
docker compose up -d                  # default + observability
pnpm build && pnpm start:staging
```

- `NODE_ENV=staging`, lee `.env.staging`.
- Logger Winston en formato `ISO + json()`.
- Loki transport activo si `LOKI_HOST` seteado.
- Traefik con ACME `caServer=https://acme-staging-v02.api.letsencrypt.org`
  (cert no-prod, evita rate-limit LE).
- Keycloak con secrets reales via `KC_API_SECRET`, `KC_PANELS_SECRET`.

### Produccion

```bash
docker compose up -d                  # default + observability
pnpm build && pnpm start:prod
```

- `NODE_ENV=production`, lee `.env.production`.
- Logger Winston en formato `ISO + json()`.
- Loki transport activo (obligatorio).
- Traefik con ACME LE produccion.
- **No usar `JWT_SECRET`** — debe estar vacio para forzar RS256 contra
  Keycloak (`src/config/env.ts:51-56`: el campo es opcional, en prod debe
  omitirse).

---

## Troubleshooting

### ACME — `acme.json` permisos invalidos

**Sintoma**: Traefik logs `error="permissions 644 for <path> are too open"`.

**Causa**: `acme.json` no tiene `chmod 600`.

**Fix**:
```bash
./scripts/init-acme.sh   # idempotente; chmod 600 explicito
```

Si ya existe, forzar:
```bash
chmod 600 data/traefik/acme/acme.json
```

### Keycloak — realm import no aplica cambios

**Sintoma**: cambios en `keycloak/app-realm.json` no se reflejan tras
`docker compose up`.

**Causa**: el import es **idempotente solo en primer arranque**. Si el
realm `app` ya existe, KC ignora el JSON.

**Fix**:
```bash
docker compose down -v   # ¡destruye volumes!
docker compose --profile dev up -d
```

> [!WARNING] `docker compose down -v` borra TODA la BBDD Mongo y los
> datos KC. Solo apto en desarrollo local.

### LocalStack — bucket no existe

**Sintoma**: `AccessDenied: The specified bucket does not exist`.

**Causa**: `localstack-init.sh` no se ejecuto (volume mount fallo).

**Fix**: verificar montaje en `docker-compose.yml`:
```yaml
volumes:
  - ./scripts/localstack-init.sh:/etc/localstack/init/ready.d/init.sh
```
Y reiniciar: `docker compose --profile dev restart localstack`.

### Traefik — basicauth dashboard roto

**Sintoma**: `https://traefik.${DOMAIN}` devuelve 401 incluso con creds
correctas.

**Causa**: `TRAEFIK_AUTH` no seteado o con placeholder default invalido
.

**Fix**: generar htpasswd bcrypt:
```bash
htpasswd -nbB admin "<password>" | sed -e 's/\$/\$\$/g'
# copiar resultado a .env.local en TRAEFIK_AUTH=
```

### Mongo — connection refused

**Sintoma**: `MongoServerSelectionError: connect ECONNREFUSED`.

**Causa**: Mongo no esta corriendo, o `MONGODB_URI` apunta a host
incorrecto.

**Fix**:
```bash
docker compose ps mongodb            # verificar status
docker compose logs mongodb --tail=50
```

`serverSelectionTimeoutMS` esta fijado a `5000` (`src/config/database.ts`)
— la API falla rapido en lugar de colgar.

### API — 401 cascada tras restart Keycloak

**Sintoma**: tras `docker compose restart keycloak`, todos los requests
con Bearer token fallan con `401 Invalid or expired token` durante ~30s.

**Causa**: el `KeycloakAdapter` cachea JWKS via `jose.createRemoteJWKSet`.
Si KC reinicia con nuevas signing keys (raro), el cache queda stale.

**Fix**: esperar a que el cache se invalide o reiniciar la API:
```bash
docker compose restart api
```

---

## Runbook de incidentes

### 502 desde Traefik

**Trigger**: cliente recibe `502 Bad Gateway` consistente.

**Diagnostico**:
1. `docker compose ps api` → ¿esta `Up (healthy)`?
2. Si `Up (unhealthy)`: la API arranco pero `/health/ready` falla → check
   Mongo.
3. `curl http://api:3000/health/ready` desde Traefik network:
   ```bash
   docker compose exec traefik wget -qO- http://api:3000/health/ready
   ```
4. Si devuelve `503` → Mongo caido o lento.

**Mitigacion**:
- Si Mongo: ver §"Mongo connection refused" en troubleshooting.
- Si API crasheo: `docker compose logs api --tail=200` y restart.

### 401 cascada en endpoints protegidos

**Trigger**: todos los requests con Bearer token devuelven `401`.

**Diagnostico**:
1. `docker compose ps keycloak` → ¿healthy?
2. `curl https://auth.${DOMAIN}/realms/app/.well-known/openid-configuration` →
   ¿200 con JSON?
3. Logs API: buscar `Invalid or expired token` en Loki:
   ```logql
   {app="express-clean-backend"} |= "Invalid or expired token"
   ```

**Mitigacion**:
- KC down → restart KC.
- JWKS unreachable → check red interna `backend` en docker-compose.
- Issuer mismatch (KC URL cambio) → revisar `KEYCLOAK_URL` y `KEYCLOAK_REALM`
  en `.env.<entorno>`.

### Cold start lento (~10s primer request admin)

**Trigger**: primer request a endpoint admin tras arranque tarda 5-15s.

**Causa esperada**: `KeycloakAdapter` necesita:
1. Obtener admin token (REST `POST /token`).
2. Cachear JWKS (`createRemoteJWKSet` lazy).

**Mitigacion**: documentar como **comportamiento esperado**. No es un bug.
Subsecuentes requests usan cache.

### Audit log llenando Mongo

**Trigger**: alerta de uso de disco en `mongodb` volume.

**Diagnostico**:
1. Conectar mongo shell:
   ```bash
   docker compose exec mongodb mongosh
   use app
   db.login_audit_logs.stats()
   ```
2. Verificar TTL index:
   ```js
   db.login_audit_logs.getIndexes()
   // debe incluir: { occurred_at: 1 } con expireAfterSeconds: 7776000
   ```

**Causa esperada**: TTL 90 dias hardcoded
(`src/infrastructure/mongodb/schemas/login-audit-log.schema.ts:42`). Mongo
TTL monitor borra cada ~60s. Si crece sin parar:
- Volumen de logins sostenido excede el TTL window.
- TTL index falto al re-deploy.

**Mitigacion**:
- Validar que el index existe (`getIndexes()`).
- Si no existe: re-conectar la API → mongoose re-crea indices al arranque.
- Aumentar disco si el volumen es legitimo.


---

## Ver tambien

- [06 — Plataforma + Deploy](../docker/platform.md): docker-compose,
  Traefik, redes, volumes.
- [07 — Seguridad](../project/security.md): hardening y defensas aplicadas.
- [08 — Configuracion](../project/configuration.md): tabla `.env reference`.
- [09 — Observabilidad](../aws/observability.md): logs, metricas, dashboards.
