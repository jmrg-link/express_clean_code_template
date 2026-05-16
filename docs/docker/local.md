# Docker Local

> Profile `local` in docker-compose: services in containers, API runs on host with hot-reload via `tsx watch`.

## Visión general

Locally, all services run in Docker (MongoDB, Keycloak, Traefik, observability) except the API, which runs on the host. This gives instant hot-reload for source changes.

**Why:**
- Changes in `src/` reflect immediately without rebuilding the image
- Attach debuggers directly to the running API process
- No Docker rebuild delay for every edit

---

## Inicio rápido

```bash
# Terminal 1: Servicios Docker
docker-compose --profile local up -d

# Terminal 2: API en host con hot-reload
npm run dev:local

# Verificar
curl http://localhost:3000/health/live
# Output: 200 OK

# Swagger UI
open http://localhost:3000/api/v1/docs
```

---

## Stack de servicios

```
Traefik 3.7        → Reverse proxy en :80, :443 (auto-redirect http→https)
MongoDB 8.2        → BD en red `backend`, puerto expuesto a 127.0.0.1:27017
Keycloak 26.6.1    → IAM en red `proxy`, puerto 127.0.0.1:8080
LocalStack 4.14.0  → S3 fake en 127.0.0.1:4566
Prometheus 3.8.1   → Scrape de métricas API
Grafana 13.0.1     → Dashboards (logs + métricas)
Loki 3.7.1         → Agregador de logs
API                → corre en HOST (no container)
```

**Redes:**
- `proxy`: Traefik, Keycloak, (API conecta vía socket)
- `backend`: MongoDB, Keycloak, (API en host accede vía 127.0.0.1)
- `monitoring`: Prometheus, Grafana, Loki

---

## Arrancar

### Opción 1: profile local (recomendado)

```bash
docker-compose --profile local up -d
```

Output:
```
✓ Network proxy created
✓ Network backend created
✓ Network monitoring created
✓ Volume mongo_data created
✓ Container mongodb started
✓ Container keycloak started
✓ Container traefik started
✓ Container localstack started
✓ Container prometheus started
✓ Container grafana started
✓ Container loki started
```

### Opción 2: sin profile (si local es default)

```bash
docker-compose up -d
```

Verificar:

```bash
docker-compose ps
# NAME          STATUS      PORTS
# mongodb       Up (healthy)
# keycloak      Up
# traefik       Up
# localstack    Up (healthy)
# prometheus    Up (healthy)
# grafana       Up
# loki          Up (healthy)
```

---

## Archivo .env.local

Crear `.env.local` en raíz del proyecto:

```bash
# Entorno
NODE_ENV=local
LOG_LEVEL=debug

# API
HOST=0.0.0.0
PORT=3000

# MongoDB (usar hostname Docker desde containers)
MONGODB_URI=mongodb://mongo:27017/express-clean-backend

# Keycloak (usar localhost desde host)
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=app
KEYCLOAK_CLIENT_ID=app-api
KEYCLOAK_CLIENT_SECRET=app-api-secret

# JWT (mínimo 16 caracteres para dev)
JWT_SECRET=dev-only-min-16-chars

# S3 / LocalStack (localhost desde host)
AWS_REGION=eu-west-1
AWS_S3_BUCKET=app-local-bucket
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_S3_ENDPOINT=http://localhost:4566
AWS_S3_FORCE_PATH_STYLE=true

# Loki (opcional)
LOKI_HOST=http://localhost:3100

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,https://localhost

# Traefik OIDC plugin (generar con: openssl rand -base64 32)
OIDC_PLUGIN_SECRET=<base64-random-string>
KC_PANELS_SECRET=<keycloak-traefik-panels-secret>

# Traefik admin (generar con: echo -n "admin:password" | base64)
TRAEFIK_AUTH=admin:$$apr1$$placeholder$$placeholder
```

**Generar secretos:**

```bash
# OIDC_PLUGIN_SECRET
openssl rand -base64 32

# TRAEFIK_AUTH (htpasswd format)
# Instalar: brew install httpd (macOS) o apt-get install apache2-utils
htpasswd -c /tmp/htpasswd admin
# Copiar output: admin:$apr1$...
# Escapar $ como $$ para docker-compose v2
```

---

## Acceso a servicios

### API (host)

```
http://localhost:3000
https://localhost:3000 (via Traefik)
```

**Swagger UI:** http://localhost:3000/api/v1/docs

**Health checks:**
```bash
curl http://localhost:3000/health/live   # liveness
curl http://localhost:3000/health/ready  # readiness
curl http://localhost:3000/metrics       # Prometheus
```

### MongoDB

```bash
# Shell
docker-compose exec mongodb mongosh --eval "db.adminCommand('ping')"

# Query con mongosh
docker-compose exec mongodb mongosh
> use express-clean-backend
> db.users.find().limit(1)
```

### Keycloak Admin

```
http://localhost:8080/admin
user: admin
password: (en .env: KC_ADMIN_PASSWORD)
```

**Cosas que hacer:**
1. Realm: `app` (pre-importado de `keycloak/app-realm.json`)
2. Usuarios: crear con rol `admin` o `user`
3. Clientes:
   - `app-api` (service account, client credentials flow)
   - `traefik-panels` (public client, OIDC + PKCE)

### Grafana

```
http://localhost:3001
user: admin
password: admin
```

**Datasources (pre-configuradas):**
- Prometheus: http://prometheus:9090
- Loki: http://loki:3100

**Dashboards:**
- API metrics (Node.js + Prometheus)
- Logs (Loki)

### Prometheus

```
http://localhost:9090
```

**Targets:** scrapeando API en http://api:3000/metrics cada 15s.

**Query ejemplos:**
```promql
# Rate de requests (5m)
rate(http_requests_total[5m])

# P95 latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Errores
rate(http_requests_total{status=~"5.."}[5m])
```

### Loki

```
http://localhost:3100/loki/api/v1/query
```

**Query de logs (LogQL):**
```logql
# Todos los logs de API
{job="api"}

# Solo errores
{job="api"} | json | level="error"

# Rate de errores/sec
rate({job="api"} | json | level="error" [1m])
```

**Nota:** Mejor acceder vía Grafana que tener Loki expuesto.

### LocalStack (S3)

```bash
# Health
curl http://localhost:4566/_localstack/health

# AWS CLI (si tienes AWS CLI instalado)
AWS_ENDPOINT_URL_S3=http://localhost:4566 \
AWS_ACCESS_KEY_ID=test \
AWS_SECRET_ACCESS_KEY=test \
aws s3 ls
```

---

## Volúmenes persistentes

| Volumen | Servicio | Ruta en container | Propósito |
|---|---|---|---|
| `mongo_data` | MongoDB | `/data/db` | BD persistente |
| `keycloak_data` | Keycloak | `/opt/keycloak/data` | Realm config, usuarios |
| `localstack_data` | LocalStack | `/var/lib/localstack` | S3 buckets |
| `prometheus_data` | Prometheus | `/prometheus` | Time-series DB |
| `grafana_data` | Grafana | `/var/lib/grafana` | Dashboards, config |
| `loki_data` | Loki | `/loki` | Log chunks |

**Persistencia:**

Datos **persisten** entre `docker-compose down/up` porque usamos volúmenes nombrados.

```bash
# Verificar volúmenes
docker volume ls

# Inspeccionar un volumen
docker volume inspect express-clean-backend_mongo_data

# Limpiar todo (CUIDADO)
docker-compose down -v
```

---

## Logs

```bash
# Todos los servicios
docker-compose logs -f

# Servicio específico
docker-compose logs -f mongodb
docker-compose logs -f keycloak
docker-compose logs -f prometheus

# Últimas N líneas
docker-compose logs --tail=100 api

# Filtrar por patrón
docker-compose logs | grep "error"
```

---

## Resolución de problemas

| Problema | Causa | Solución |
|---|---|---|
| **"Cannot reach MongoDB"** | API no encuentra `mongo:27017` | Verificar que MongoDB está en red `backend`. Usar `mongodb://mongo:27017` (no localhost) |
| **"Keycloak admin/admin no va"** | KC_ADMIN_PASSWORD no seteada | `docker-compose logs keycloak`, verificar `.env.local` |
| **"Traefik redirect loop (http→https)"** | DOMAIN=localhost, certs auto-firmados | Usar `https://localhost:3000` directamente. Ignorar warning de cert |
| **"Hot-reload no funciona"** | `npm run dev:local` no activa tsx watch | Verificar `src/` contiene `.ts` files. Verificar NODE_ENV=local en `.env.local` |
| **"Port 3000 already in use"** | Otro proceso escuchando | `lsof -i :3000`. O cambiar PORT en `.env.local` |
| **"Prometheus no scrapeando"** | API no expone `/metrics` | Verificar `src/presentation/routers/metrics-router.ts`. Test: `curl http://localhost:3000/metrics` |
| **"Loki no recibiendo logs"** | Winston/Loki transport no configurado | `.env.local`: `LOKI_HOST=http://localhost:3100`. Verificar `src/infrastructure/logging/logger.ts` |
| **"Disk space lleno"** | Volúmenes grandes | `docker volume prune` o `docker-compose down -v` + rebuild |

---

## Ejemplos de desarrollo

### Agregar endpoint

```bash
# 1. En VS Code, editar src/presentation/routers/user-router.ts
# Agregar:
#   router.get('/test', (req, res) => res.json({ ok: true }))

# 2. Cambios detectados automáticamente (tsx watch)

# 3. Test
curl http://localhost:3000/api/v1/users/test
# Output: {"ok":true}
```

### Inspeccionar BD

```bash
docker-compose exec mongodb mongosh
> use express-clean-backend
> db.users.find({ email: "test@example.com" })
```

### Debug con VS Code

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "attach",
      "name": "Attach to running API",
      "port": 9229,
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

```bash
# Arrancar API en debug mode
NODE_OPTIONS=--inspect npm run dev:local
```

---

## Parar servicios

```bash
# Parar sin eliminar volúmenes
docker-compose down

# Parar + eliminar volúmenes (CUIDADO)
docker-compose down -v

# Eliminar solo containers (mantener volúmenes)
docker-compose rm -f
```

---

## Ajustes de rendimiento

**Si Docker es lento (especialmente en Mac/Windows):**

1. Aumentar RAM asignada a Docker Desktop
   - Preferences → Resources → Memory: 4GB → 8GB+

2. Usar volumes optimizados (Mac)
   ```yaml
   volumes:
     mongo_data:
       driver: local
       driver_opts:
         type: tmpfs
         device: tmpfs
   ```

3. Deshabilitar observability si no necesitas logs
   ```bash
   docker-compose --profile local down
   docker-compose up -d  # sin profile, no inicia loki/grafana/prometheus
   ```

---

## Referencias

- [`docker-compose.yml`](../../docker-compose.yml) — configuración completa
- [`README.md`](./README.md) — visión general de profiles
- [`.env.example`](../../.env.example) — template de env vars
- [Keycloak docs](https://www.keycloak.org/docs/) (v26.6.1)
- [LocalStack docs](https://docs.localstack.cloud/) (S3)
