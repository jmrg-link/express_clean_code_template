# Local — Development on localhost

> Full stack running in local docker-compose. Isolated dev environment with no AWS or external domain dependencies.

## Services

```
localhost:3000   → Express API (Node.js)
localhost:27017  → MongoDB
localhost:8080   → Keycloak (OIDC)
localhost:9090   → Prometheus (metrics)
localhost:3001   → Grafana (dashboards)
localhost:3100   → Loki (logs)
localhost:4566   → LocalStack (S3 fake)
localhost:5672   → RabbitMQ (futuro)
```

## Arrancar el stack

### Requisitos previos

```bash
# Node.js >= 22.0.0
node --version

# Docker Desktop
docker --version
docker-compose --version

# Dependencias npm
npm install
```

### Archivo de configuración

**`.env.local`** (copiar de `.env.example` y customizar):

```bash
NODE_ENV=local
MONGODB_URI=mongodb://localhost:27017/app
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=app
KEYCLOAK_CLIENT_ID=app-api
KEYCLOAK_CLIENT_SECRET=your-secret-here
AWS_S3_BUCKET=localstack
AWS_S3_REGION=us-east-1
AWS_S3_ENDPOINT=http://localhost:4566
ALLOWED_ORIGINS=http://localhost:3000
```

### Iniciar servicios

```bash
# 1. Subir todos los servicios (dev profile)
docker-compose --profile dev up -d

# 2. Esperar ~10s para que Keycloak inicie
sleep 10

# 3. En otra terminal, iniciar API dev
npm run dev:local

# API estará en http://localhost:3000
```

### Verificar que todo funciona

```bash
# Healthcheck del API
curl http://localhost:3000/health

# Login test
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password123"}'

# Prometheus metrics
curl http://localhost:9090/metrics

# Loki logs
curl http://localhost:3100/loki/api/v1/query?query=\{job=\"api\"\}

# Grafana (acceso en browser)
open http://localhost:3001
# User: admin / Password: admin
```

## Servicios en detalle

### Express API (Node.js)

**Puerto:** 3000
**Archivo:** N/A (npm run dev:local)

**Corre en host local, no en container.** Razón: hot-reload con `tsx watch`, debugging más fácil, conexión a BD local sin DNS.

```bash
npm run dev:local
# o
cross-env NODE_ENV=local dotenv -e .env.local -- tsx watch src/main.ts
```

**Endpoints disponibles:**
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/refresh-token`
- `GET /api/v1/auth/me`
- `GET /api/v1/users` (requiere token)
- `GET /api/v1/users/:id`
- `POST /api/v1/users`
- `PATCH /api/v1/users/:id`
- `DELETE /api/v1/users/:id` (soft delete)
- `GET /api/v1/storage/presigned-url`
- `GET /api/v1/storage/objects`

### MongoDB

**Puerto:** 27017
**Container:** `express-clean-backend-mongo-1`
**Volumen:** `mongodata` (persistente entre reboots)
**Usuario:** root / root (default, NO CAMBIAR en local)

```bash
# Acceder al shell
docker exec -it express-clean-backend-mongo-1 mongosh

# Listar bases de datos
> show dbs

# Usar base de datos 'app'
> use app

# Listar colecciones
> show collections

# Query ejemplo
> db.users.find().pretty()

# Salir
> exit
```

**Esquemas:**
- `users` — Usuarios registrados
- `loginAuditLogs` — Histórico de logins (TTL 90 días)
- `sessions` (futuro) — Session store

### Keycloak

**Puerto:** 8080
**URL:** http://localhost:8080
**Admin User:** admin / admin
**Realm:** app
**Client:** app-api (client ID + secret en `.env.local`)

```bash
# Acceder a Keycloak Admin Console
open http://localhost:8080/admin

# Username: admin
# Password: admin
```

**Configuración típica:**
- Realm: `app`
- Client: `app-api` (confidential client, OIDC)
- Client scopes: `openid`, `profile`, `email`
- Roles: `admin`, `user`
- Users: `admin@example.com`, `user@example.com`

**Test login:**
```bash
curl -X POST http://localhost:8080/realms/app/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=app-api" \
  -d "client_secret=your-secret" \
  -d "username=admin@example.com" \
  -d "password=admin" \
  -d "grant_type=password"
```

### Prometheus

**Puerto:** 9090
**URL:** http://localhost:9090
**Config:** `monitoring/prometheus.yml`

Scrape targets:
- `localhost:3000/metrics` (Express API)

```bash
# Ejemplos de queries
# Total requests
http_requests_total

# Latencia p95
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Errors per endpoint
rate(http_requests_total{status="500"}[5m])
```

### Grafana

**Puerto:** 3001
**URL:** http://localhost:3001
**User:** admin / admin
**Password:** admin (cambiar en producción)

**Datasources:**
- Prometheus: http://prometheus:9090
- Loki: http://loki:3100

**Dashboards:**
- API Overview (monitoring/grafana/dashboards/api-overview.json)
- Logs (auto-included con Loki datasource)

### Loki

**Puerto:** 3100
**Config:** `monitoring/loki.yml`
**Scrape target:** Express API logs via Winston

Logs visibles en:
- Grafana Explore → Loki
- LogQL query: `{job="api"}`

### LocalStack (AWS S3 fake)

**Puerto:** 4566
**Endpoint:** http://localhost:4566
**Bucket:** `localstack` (auto-creado)

```bash
# Test S3 con AWS CLI apuntando a LocalStack
aws s3 ls s3://localstack \
  --endpoint-url http://localhost:4566 \
  --region us-east-1

# Upload test file
echo "test content" > /tmp/test.txt
aws s3 cp /tmp/test.txt s3://localstack/test.txt \
  --endpoint-url http://localhost:4566 \
  --region us-east-1

# List objects
aws s3 ls s3://localstack \
  --endpoint-url http://localhost:4566 \
  --region us-east-1
```

**Nota:** API usa AWS SDK con `AWS_S3_ENDPOINT=http://localhost:4566`, así que presigned URLs apuntan a LocalStack.

## Workflow típico: desarrollo local

```bash
# 1. Clone repo + install
git clone https://github.com/jmrg/express-clean-backend.git
cd express-clean-backend
npm install

# 2. Copiar .env.local
cp .env.example .env.local
# Editar .env.local con tus valores

# 3. Subir stack Docker
docker-compose --profile dev up -d

# 4. Verificar Keycloak está listo
sleep 10
curl http://localhost:8080 -s | head -20

# 5. Crear usuario de test en Keycloak (opcional, fakeAdapter OK en tests)
open http://localhost:8080/admin

# 6. En nueva terminal, start dev server
npm run dev:local

# API en http://localhost:3000
# Logs en stdout (hot-reload con tsx watch)

# 7. Test API
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}'

# 8. Ver logs en Grafana
open http://localhost:3001
# Explore → Loki → {job="api"}

# 9. Escribir código, tests pasan automáticamente (vitest watch)
npm run test:watch

# 10. Commit + push
git add .
git commit -m "feat(auth): ..."
git push origin feature/myfeature
```

## Solución de problemas

### "Cannot connect to MongoDB"
```bash
# Verificar que Mongo está corriendo
docker ps | grep mongo

# Si no:
docker-compose --profile dev up -d mongo

# Esperar 5s
sleep 5

# Verificar connación
docker exec -it express-clean-backend-mongo-1 mongosh --eval "db.adminCommand('ping')"
```

### "Keycloak returns 502 Bad Gateway"
```bash
# Keycloak tarda en iniciar (~30s)
docker-compose logs keycloak | tail -20

# Esperar hasta que veas "Listening on http://0.0.0.0:8080"

# O reiniciar
docker-compose restart keycloak
sleep 30
```

### "Cannot find module in npm run dev:local"
```bash
# Reinstalar deps
rm -rf node_modules package-lock.json
npm install

# Verificar path aliases en tsconfig.json y vitest.config.ts
cat tsconfig.json | grep -A 10 '"paths"'
```

### "LocalStack S3 bucket not found"
```bash
# Crear bucket manualmente
docker exec -it express-clean-backend-localstack-1 \
  awslocal s3 mb s3://localstack
```

### "Port 3000 already in use"
```bash
# Verificar qué ocupa puerto 3000
lsof -i :3000

# Matar proceso
kill -9 <PID>

# O cambiar MONGODB_URI en .env.local y npm run dev:local escuchará diferente
```

## Detener servicios

```bash
# Parar sin eliminar (datos persisten)
docker-compose --profile dev stop

# Detener y eliminar contenedores (datos persisten en volúmenes)
docker-compose --profile dev down

# Detener, eliminar y LIMPIAR volúmenes (BE CAREFUL)
docker-compose --profile dev down -v
```

## Debugging

### VS Code

Instalar extensión "Thunder Client" o "REST Client", luego crear `.http` con requests:

```http
@baseUrl = http://localhost:3000
@token = [token de login aquí]

### Login
POST {{baseUrl}}/api/v1/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "password123"
}

### Get users (requiere token)
GET {{baseUrl}}/api/v1/users
Authorization: Bearer {{token}}
```

### Logs

```bash
# Logs de API (stdout en terminal npm run dev:local)
# + Logs en Grafana Loki
open http://localhost:3001
# Explore → Loki

# Logs de Mongo
docker logs express-clean-backend-mongo-1 | tail -50

# Logs de Keycloak
docker logs express-clean-backend-keycloak-1 | tail -100
```

## Diferencias local vs staging/prod

| Aspecto | Local | Staging | Production |
|---|---|---|---|
| **API host** | localhost:3000 | staging.api.example.com | api.example.com |
| **BD** | local mongo | EC2 mongo | EC2 mongo + auth |
| **Keycloak** | container local | prod shared | prod shared |
| **S3** | LocalStack | AWS S3 prod | AWS S3 prod |
| **HTTPS** | no (http) | Let's Encrypt | Let's Encrypt |
| **Traefik** | none | yes | yes + HA |
| **Monitoring** | container local | EC2 | EC2 + CloudWatch |

## Referencias

- docker-compose config: [`docker-compose.yml`](../../docker-compose.yml)
- Docker detail: [`docs/docker/local.md`](../docker/local.md)
- Full infra docs: [`docs/project/adapters.md`](.../project/adapters.md)
- Keycloak setup: [`docs/firebase/auth.md`](../firebase/auth.md)
