# Docker Producción

> Perfil `production` en docker-compose: EC2 con certificados Let's Encrypt real, AWS S3 y secretos de Secrets Manager.

## Visión general

Producción corre con seguridad y confiabilidad en mente:
- Traefik con certificados Let's Encrypt real
- AWS S3 para storage (sin LocalStack)
- Secretos fetched de AWS Secrets Manager
- MongoDB con backups nocturnos
- Prometheus y Loki (Grafana accedido via VPN o no expuesto)
- Logs CloudWatch y alertas

---

## Inicio rápido en EC2 (production)

```bash
# 1. SSH a EC2 (private subnet)
ssh -i prod.pem ubuntu@prod-ip

# 2. Clone + setup
cd /home/ubuntu/app
git clone <repo-url> .
git checkout main

# 3. Fetch secrets from AWS Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id /app/prod/env \
  --region us-east-1 \
  --query SecretString \
  --output text | jq -r 'to_entries | .[] | "\(.key)=\(.value)"' > .env.production

# 4. Start services
docker-compose --profile production up -d

# 5. Verify
curl https://api.example.com/health/live
docker-compose ps
```

---

## Stack de servicios (minimalista)

```
Traefik 3.7        → Reverse proxy, ACME real, SSL/TLS
Express API        → Container, puerto 3000 (internal)
MongoDB 8.2        → Container, puerto 27017 (VPC only)
Prometheus 3.8.1   → Métricas (no expuesto públicamente)
Loki 3.7.1         → Logs (no expuesto públicamente)
```

**Notar:**
- Sin LocalStack (usa AWS S3 real)
- Sin Grafana público (acceso via CloudWatch o VPN)
- Sin Keycloak (IAM delegado a external providers via API)

**Redes:**
- `proxy`: Traefik, API
- `backend`: API, MongoDB
- `monitoring`: Prometheus, Loki, API (scraping)

---

## Archivo .env.production

NO versionado en git. Fetched de AWS Secrets Manager:

```bash
# Fetching (desde CI/CD o EC2)
aws secretsmanager get-secret-value \
  --secret-id /app/prod/env \
  --region us-east-1 \
  --query SecretString \
  --output text > .env.production

# Contenido (ejemplo)
NODE_ENV=production
LOG_LEVEL=warn

# API
HOST=0.0.0.0
PORT=3000

# MongoDB (VPC internal)
MONGODB_URI=mongodb://mongodb:27017/express-clean-backend
MONGODB_REPLICA_SET=rs0  # opcional para HA

# Keycloak (external)
KEYCLOAK_URL=https://auth.example.com
KEYCLOAK_REALM=app
KEYCLOAK_CLIENT_ID=app-api
KEYCLOAK_CLIENT_SECRET=<secret-en-secrets-manager>

# JWT
JWT_SECRET=<64-char-secret-de-secrets-manager>

# AWS S3 (real, no LocalStack)
AWS_REGION=us-east-1
AWS_S3_BUCKET=app-prod-bucket
AWS_S3_FORCE_PATH_STYLE=false
# AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY vienen del IAM role de la EC2

# Loki (internal)
LOKI_HOST=http://loki:3100

# CORS
CORS_ORIGINS=https://app.example.com

# Traefik OIDC (opcional si proxying paneles internos)
OIDC_PLUGIN_SECRET=<base64-32-chars>
TRAEFIK_AUTH=admin:$$apr1$$...

# ACME Let's Encrypt (real)
LE_CA_SERVER=https://acme-v02.api.letsencrypt.org/directory
SSL_EMAIL=ops@example.com

# Domain
DOMAIN=your-domain.tld
```

---

## AWS Secrets Manager setup

### Crear secret

```bash
# 1. Local: crear JSON de secretos
cat > /tmp/prod-secrets.json << 'EOF'
{
  "KEYCLOAK_CLIENT_SECRET": "xxx",
  "JWT_SECRET": "yyy",
  "MONGODB_PASSWORD": "zzz",
  "AWS_SECRET_ACCESS_KEY": "aaa"
}
EOF

# 2. AWS: crear secret
aws secretsmanager create-secret \
  --name /app/prod/env \
  --description "Production env vars" \
  --secret-string file:///tmp/prod-secrets.json \
  --region us-east-1

# 3. Verificar
aws secretsmanager get-secret-value \
  --secret-id /app/prod/env \
  --region us-east-1 | jq '.SecretString | fromjson'
```

### Actualizar secret

```bash
aws secretsmanager update-secret \
  --secret-id /app/prod/env \
  --secret-string file:///tmp/updated-secrets.json \
  --region us-east-1
```

### IAM role para EC2

EC2 necesita permiso de lectura:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:/app/prod/env*"
    }
  ]
}
```

---

## Traefik con ACME Let's Encrypt

Traefik maneja automatización de ACME:

### Primer start (obtener certs)

```bash
docker-compose --profile production up -d traefik

# Logs de ACME
docker-compose logs traefik | grep -i "acme\|challenge"

# Verificar acme.json (almacena certs privados)
docker-compose exec traefik ls -la /etc/traefik/acme/acme.json

# Certs guardados con permisos 600 (solo root)
docker-compose exec traefik stat /etc/traefik/acme/acme.json
```

### Renovación automática

Traefik verifica certs cada 12h. Renueva si < 30 días para expirar.

```bash
# Ver próximas renovaciones
docker-compose exec traefik cat /etc/traefik/acme/acme.json | jq '.Certificates[] | {domain, expiration}'
```

### Certificados válidos

```bash
# Test SSL
openssl s_client -connect api.example.com:443

# Browser
curl https://api.example.com/health/live
# Sin warnings de cert (certificado válido de LE)
```

---

## MongoDB backup (cron)

Script en EC2 (`/home/ubuntu/backup-mongo.sh`):

```bash
#!/bin/bash

# Backup diario de MongoDB
BACKUP_DIR="/mnt/backups/mongo"
CONTAINER="mongodb"
BACKUP_DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Dump
docker-compose exec $CONTAINER mongodump \
  --out /tmp/mongo-dump-$BACKUP_DATE

# Compress
tar -czf $BACKUP_DIR/mongo-$BACKUP_DATE.tar.gz \
  /tmp/mongo-dump-$BACKUP_DATE

# Cleanup
rm -rf /tmp/mongo-dump-$BACKUP_DATE

# Upload to S3
aws s3 cp $BACKUP_DIR/mongo-$BACKUP_DATE.tar.gz \
  s3://app-backups-prod/mongo/

# Retention: keep last 30 days
find $BACKUP_DIR -name "mongo-*.tar.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR/mongo-$BACKUP_DATE.tar.gz"
```

Cron job:

```bash
# /etc/cron.d/app-backup
0 2 * * * ubuntu /home/ubuntu/backup-mongo.sh >> /var/log/app-backup.log 2>&1
```

---

## Monitoreo & alertas

### CloudWatch + SNS

```bash
# Métricas de API
aws cloudwatch put-metric-alarm \
  --alarm-name "API-ErrorRate" \
  --alarm-description "Alert if error rate > 5%" \
  --metric-name ErrorRate \
  --namespace "ExpressAPI" \
  --statistic Average \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:ops-alerts
```

### Logs en CloudWatch

Traefik, API se envían a CloudWatch Logs:

```bash
# Ver logs (via CLI)
aws logs tail /aws/ecs/app-api --follow

# Filter: solo errores
aws logs filter-log-events \
  --log-group-name /aws/ecs/app-api \
  --filter-pattern "ERROR"
```

### Prometheus queries

```promql
# Error rate
rate(http_requests_total{status=~"5.."}[5m])

# Response time P95
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# API uptime (1 = up, 0 = down)
up{job="api"}
```

---

## Logs

Todos dirigidos a Loki (coleccionados, no stdout visible):

```bash
# Via CloudWatch (recommended)
aws logs tail /aws/ecs/app-api --follow

# Via SSH + container
docker-compose logs -f api

# Via Loki (si expuesto internamente)
curl http://loki:3100/loki/api/v1/query?query={job%3D%22api%22}
```

---

## Volúmenes persistentes

| Volumen | Contenido | Crítico |
|---|---|---|
| `mongo_data` | Datos MongoDB | SÍ (backup diario) |
| `prometheus_data` | Time-series | NO (recollectable) |
| `loki_data` | Log chunks | NO (archivable) |

**Backup policy:**
- MongoDB: diario a S3 (via cron + aws s3 cp)
- Prometheus: optional (recalculable)
- Traefik acme.json: en volumen persistente (con backup S3)

---

## Seguridad

### Network isolation

- API, MongoDB: en VPC private subnet
- Traefik: ALB (Application Load Balancer) enfrente (TLS termination)
- Bases de datos: sin acceso público

### Secretos

- NO en .env versionado
- Fetched en runtime desde Secrets Manager
- IAM role-based access (no credentials hardcoded)
- acme.json con permisos 600

### CORS

```
CORS_ORIGINS=https://app.example.com
```

Solo frontend autorizado. Rate limiting 100 req/min en `/api/v1`.

### Traefik

- Security headers (HSTS, CSP, X-Frame-Options)
- No dashboard público (si activo, auth obligatorio)

---

## Health monitoring

```bash
# Liveness
curl https://api.example.com/health/live
# Readiness
curl https://api.example.com/health/ready
# Metrics
curl https://api.example.com/metrics
```

---

## Resolución de problemas

| Problema | Solución |
|---|---|
| **"ACME challenge failing"** | DNS debe resolver api.example.com. Ver `docker logs traefik \| grep challenge`. Revisar SecurityGroups 80/443 abiertos |
| **"Secrets Manager access denied"** | EC2 IAM role debe tener permisos secretsmanager:GetSecretValue |
| **"MongoDB connection refused"** | Esperar healthcheck. Ver `docker-compose ps`. Verificar MONGODB_URI en .env.production |
| **"API errors in logs"** | `docker-compose logs api`. Verificar secretos (KEYCLOAK_CLIENT_SECRET, JWT_SECRET) |
| **"Disk full"** | Loki/Prometheus guardando demasiados logs. Ajustar retention policies. Limpiar volúmenes antiguos |
| **"Let's Encrypt rate limited"** | Usar staging ACME primero. Luego cambiar LE_CA_SERVER a producción |

---

## Disaster recovery

### Restore MongoDB backup

```bash
# 1. Fetch from S3
aws s3 cp s3://app-backups-prod/mongo/mongo-20250510_020000.tar.gz /tmp/

# 2. Extract
tar -xzf /tmp/mongo-20250510_020000.tar.gz -C /tmp/

# 3. Restore (con MongoDB corriendo)
docker-compose exec mongodb mongorestore /tmp/mongo-dump-20250510_020000
```

### Blue-green deployment

1. Levantar segundo set de servicios (blue)
2. Testear en blue
3. Cambiar DNS a blue
4. Mantener green como rollback

---

## Roadmap

- [ ] MongoDB replica set (HA)
- [ ] ECS Fargate en lugar de EC2 puro
- [ ] RDS Managed MongoDB (vs self-hosted)
- [ ] CDN CloudFront enfrente

---

## Referencias

- [`docker-compose.yml`](../../docker-compose.yml) — configuración completa
- [`README.md`](./README.md) — visión general
- [`docs/aws/ec2.md`](../aws/ec2.md) — setup EC2
- [AWS Secrets Manager docs](https://docs.aws.amazon.com/secretsmanager/)
- [Let's Encrypt rate limits](https://letsencrypt.org/docs/rate-limits/)
- [Traefik ACME docs](https://doc.traefik.io/traefik/https/acme/)
