# Docker Development

> Profile `development` in docker-compose: all services containerized on EC2 with Traefik ACME staging certificates.

## Visión general

Staging on EC2 runs everything in containers: API, MongoDB, Keycloak, observability stack. Traefik uses ACME staging to test certificate automation before production.

**Differences from local:**
- API runs in a container (no hot-reload)
- Traefik acts as public reverse proxy
- Observability stack (Prometheus, Loki, Grafana) is included
- Config comes from `.env.staging`, not `.env.local`

---

## Inicio rápido en EC2

```bash
# 1. SSH a EC2
ssh ubuntu@staging.example.com

# 2. Clone + setup
cd /home/ubuntu/app
git clone <repo-url> .
git checkout main

# 3. Crear .env.staging
cat > .env.staging << EOF
NODE_ENV=staging
MONGODB_URI=mongodb://mongodb:27017/express-clean-backend
KEYCLOAK_URL=http://keycloak:8080
KEYCLOAK_REALM=app
KEYCLOAK_CLIENT_ID=app-api
KEYCLOAK_CLIENT_SECRET=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
AWS_REGION=eu-west-1
AWS_S3_BUCKET=app-staging-bucket
AWS_S3_ENDPOINT=http://localhost:4566
LOKI_HOST=http://loki:3100
OIDC_PLUGIN_SECRET=$(openssl rand -base64 32)
KC_PANELS_SECRET=$(openssl rand -base64 32)
TRAEFIK_AUTH=admin:$$apr1$$placeholder$$placeholder
KC_ADMIN_PASSWORD=$(openssl rand -base64 16)
DOMAIN=staging.example.com
EOF

# 4. Arrancar servicios
docker-compose --profile development up -d

# 5. Verificar
curl https://api.staging.example.com/health/live
```

---

## Stack de servicios

```
Traefik 3.7        → Reverse proxy, ACME staging, OIDC plugin
Express API        → Containerizado, puerto 3000 (internal)
MongoDB 8.2        → Red backend, puerto 27017 (internal)
Keycloak 26.6.1    → IAM, red proxy, puerto 8080 (internal)
LocalStack 4.14.0  → S3 fake (opcional, para testing)
Prometheus 3.8.1   → Scrape API metrics
Grafana 13.0.1     → Dashboards
Loki 3.7.1         → Log aggregation
```

**Redes:**
- `proxy`: Traefik, Keycloak, API, Grafana, Prometheus
- `backend`: API, MongoDB, LocalStack
- `monitoring`: Prometheus, Grafana, Loki, API

---

## Archivo .env.staging

Crear `.env.staging` en raíz:

```bash
# Entorno
NODE_ENV=staging
LOG_LEVEL=info

# API
HOST=0.0.0.0
PORT=3000
API_PREFIX=/api
API_VERSION=v1

# MongoDB (usar hostname Docker)
MONGODB_URI=mongodb://mongodb:27017/express-clean-backend

# Keycloak (usar hostname Docker)
KEYCLOAK_URL=http://keycloak:8080
KEYCLOAK_REALM=app
KEYCLOAK_CLIENT_ID=app-api
KEYCLOAK_CLIENT_SECRET=<secret-aqui>
KEYCLOAK_INTERNAL_URL=http://keycloak:8080

# JWT
JWT_SECRET=<32-char-secret>

# S3 (LocalStack en staging)
AWS_REGION=eu-west-1
AWS_S3_BUCKET=app-staging-bucket
AWS_S3_ENDPOINT=http://localhost:4566
AWS_S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# Loki
LOKI_HOST=http://loki:3100

# CORS
CORS_ORIGINS=https://app.staging.example.com,https://localhost

# Traefik OIDC
OIDC_PLUGIN_SECRET=<base64-32-chars>
KC_PANELS_SECRET=<keycloak-secret>
TRAEFIK_AUTH=admin:$$apr1$$...
KC_ADMIN_PASSWORD=<password>

# Domain
DOMAIN=staging.example.com

# ACME (staging)
LE_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory
SSL_EMAIL=admin@example.com
```

---

## Traefik con ACME staging

Traefik en profile `development` usa ACME staging (certs auto-firmados, sin validación real).

```bash
# Ver logs de ACME
docker-compose logs traefik | grep -i acme

# Verificar acme.json
docker-compose exec traefik cat /etc/traefik/acme/acme.json | jq .

# Certificados staging (válidos pero untrusted)
# Navegadores mostrarán warning. Para production usar ACME real.
```

**Routers Traefik en staging:**

```
api.staging.example.com       → api:3000
auth.staging.example.com      → keycloak:8080
api.prometheus.staging.ex.com → prometheus:9090 (con OIDC auth)
api.grafana.staging.example.com → grafana:3000 (con OIDC auth)
api.traefik.staging.example.com → traefik:8082 (dashboard, con basicauth + OIDC)
```

---

## Healthchecks

Todos los servicios incluyen healthchecks:

```bash
# MongoDB
docker-compose exec mongodb mongosh --quiet --eval "db.adminCommand('ping').ok"

# API
curl http://localhost:3000/health/ready

# Keycloak
curl http://localhost:9000/health/live

# Prometheus
curl http://localhost:9090/-/ready

# Traefik
docker-compose exec traefik traefik healthcheck --ping
```

**Verificar estado:**

```bash
docker-compose ps
# NAME              STATUS           HEALTH
# api               Up (healthy)     ✓
# mongodb           Up (healthy)     ✓
# keycloak          Up               ✓
# traefik           Up (healthy)     ✓
# prometheus        Up (healthy)     ✓
# grafana           Up               ✓
# loki              Up (healthy)     ✓
```

---

## Acceso a servicios en staging

### API

```
https://api.staging.example.com
```

**Swagger:**
```
https://api.staging.example.com/api/v1/docs
```

**Health:**
```bash
curl https://api.staging.example.com/health/ready
curl https://api.staging.example.com/metrics
```

### Keycloak Admin

```
https://auth.staging.example.com/admin
user: admin
password: (en .env.staging: KC_ADMIN_PASSWORD)
```

### Prometheus

```
https://api.prometheus.staging.example.com
(protegido con OIDC + admin role)
```

### Grafana

```
https://api.grafana.staging.example.com
(protegido con OIDC + admin role)
```

### Traefik Dashboard

```
https://api.traefik.staging.example.com
(protegido con basicauth + OIDC + admin role)
```

---

## Logs

```bash
# Todos
docker-compose logs -f

# API
docker-compose logs -f api

# Traefik (ACME, routing)
docker-compose logs -f traefik

# MongoDB
docker-compose logs -f mongodb
```

---

## Volúmenes persistentes

| Volumen | Contenido |
|---|---|
| `mongo_data` | Datos MongoDB |
| `keycloak_data` | Realms, usuarios |
| `localstack_data` | S3 buckets |
| `prometheus_data` | Time-series |
| `grafana_data` | Dashboards |
| `loki_data` | Log chunks |

```bash
# Limpiar volumes (borra datos)
docker-compose down -v
```

---

## Diferencias: local vs development vs production

| Aspecto | local | development | production |
|---|---|---|---|
| **API** | host (hot-reload) | container | container |
| **ACME** | none | staging (self-signed) | real (Let's Encrypt) |
| **Env** | .env.local | .env.staging | .env.production (AWS Secrets Mgr) |
| **S3** | LocalStack | LocalStack | AWS S3 real |
| **Monitoring** | ✓ Loki, Prometheus, Grafana | ✓ | ✓ |
| **Secretos** | archivos .env | archivos .env | AWS Secrets Manager |
| **Debugging** | attacher VS Code | container logs | CloudWatch logs |

---

## Resolución de problemas

| Problema | Solución |
|---|---|
| **"API not reachable https://api.staging.example.com"** | Verificar DOMAIN=staging.example.com en .env. Traefik tarda ~30s en routing. Ver `docker-compose logs traefik` |
| **"ACME certificate error"** | Staging ACME es auto-firmado. Navegadores mostrarán warnings. Curl: `curl -k https://...` para ignorar certs |
| **"Keycloak admin no funciona"** | KC_ADMIN_PASSWORD debe estar en .env.staging. Ver `docker-compose logs keycloak` |
| **"Database connection refused"** | Esperar a que MongoDB esté healthy (~30s). Ver `docker-compose ps` health status |
| **"API logs showing errors"** | `docker-compose logs api` para diagnóstico. Verificar env vars con `docker-compose exec api env \| grep MONGODB` |

---

## Despliegue en EC2

1. **AMI setup:** Ubuntu 22.04 LTS + Docker + Docker Compose + git
2. **Security groups:** 80, 443 abiertos. 27017 (MongoDB) solo desde VPC
3. **IAM roles:** EC2 necesita permisos para LocalStack (S3 fake)
4. **DNS:** `staging.example.com` apunta a IP de EC2
5. **Cron backups:** (ver `docs/aws/ec2.md`)

---

## Referencias

- [`docker-compose.yml`](../../docker-compose.yml) — configuración completa
- [`README.md`](./README.md) — visión general de profiles
- [Traefik OIDC plugin](https://github.com/sevensolutions/traefik-oidc-auth) — autenticación
- [Keycloak staging setup](https://www.keycloak.org/docs/latest/server_admin/index.html)
