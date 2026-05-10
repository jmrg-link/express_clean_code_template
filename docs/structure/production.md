# Production — EC2 with HA

> Production deployment on EC2: backups, disaster recovery, and continuous monitoring.

## Arquitectura

```mermaid
flowchart TB
    Internet["Internet<br/>(Público)"]
    
    subgraph AZ1["AWS Region (us-east-1)"]
        subgraph EC2Prod["EC2 t.micro (production)"]
            Traefik["Traefik 3.7<br/>ACME Let's Encrypt<br/>:80, :443<br/>api.example.com"]
            
            subgraph Docker["Docker Compose"]
                API["Express API<br/>:3000"]
                Mongo["MongoDB 8.2<br/>:27017<br/>(container)"]
                Prometheus["Prometheus<br/>:9090"]
                Loki["Loki<br/>:3100"]
            end
        end
    end
    
    KC["Keycloak prod<br/>(shared)<br/>kc.example.com"]
    S3Prod["AWS S3<br/>app-prod-bucket"]
    S3Backup["AWS S3<br/>app-prod-backups"]
    CloudWatch["CloudWatch<br/>(logs + metrics)"]
    SNS["AWS SNS<br/>(alerts)"]
    Route53["AWS Route 53<br/>(DNS)"]
    
    Route53 -->|api.example.com| Internet
    Internet -->|HTTPS<br/>api.example.com| Traefik
    Traefik -->|forward| API
    API -->|query| Mongo
    API -->|auth| KC
    API -->|presigned| S3Prod
    API -->|logs| Loki
    API -->|metrics| Prometheus
    Mongo -->|nightly dump| S3Backup
    API -->|ship logs| CloudWatch
    CloudWatch -->|threshold| SNS
    SNS -->|alert| Internet
    
    style EC2Prod fill:#e8f5e9,stroke:#2e7d32,color:#000
    style S3Backup fill:#ffccbc,stroke:#bf360c
    style SNS fill:#ffe0b2,stroke:#e65100
```

## Instance & Security

**Instance Type:** t.micro (free tier) o t.small (production recomendado)
**AMI:** Amazon Linux 2023
**EBS Volume:** 50 GB (gp3) con snapshots diarios
**Security Group:**
- Inbound: 22 (SSH) de IP office/VPN, 80, 443 (HTTP/HTTPS)
- Outbound: Todo (para AWS APIs, Keycloak, etc.)

**EC2 Key:** guardado en 1Password, nunca commiteado

## Setup Production

### 1. Lanzar instancia

```bash
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t2.micro \
  --key-name prod-key \
  --security-groups prod-sg \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=api-prod},{Key=Environment,Value=production}]' \
  --monitoring Enabled=true
```

### 2. Preparar instancia

```bash
ssh -i prod-key.pem ec2-user@<instance-ip>

# Update, Docker, Git
sudo yum update -y
sudo yum install -y docker git aws-cli

# Docker daemon
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user
newgrp docker

# Clone + setup
git clone https://github.com/jmrg/express-clean-backend.git
cd express-clean-backend
cp .env.example .env.production
# Editar .env.production (ver abajo)
```

### 3. Secretos via AWS Secrets Manager

**En lugar de .env.production directamente:**

```bash
# Crear secreto
aws secretsmanager create-secret \
  --name /app/prod/env \
  --secret-string '{"MONGODB_PASSWORD":"...","KEYCLOAK_CLIENT_SECRET":"..."}' \
  --region us-east-1

# En deployment script, fetch y exporte:
aws secretsmanager get-secret-value \
  --secret-id /app/prod/env \
  --query SecretString \
  --output text | jq -r 'to_entries | .[] | "\(.key)=\(.value)"' > .env.production
```

## Variables de entorno (.env.production)

```bash
NODE_ENV=production

# Database
MONGODB_URI=mongodb://mongo:27017/app
MONGODB_USER=admin
MONGODB_PASSWORD=<aws-secrets-manager>

# Keycloak
KEYCLOAK_URL=https://kc.example.com
KEYCLOAK_REALM=app
KEYCLOAK_CLIENT_ID=app-api
KEYCLOAK_CLIENT_SECRET=<aws-secrets-manager>

# AWS
AWS_REGION=us-east-1
AWS_S3_BUCKET=app-prod-bucket
AWS_ACCESS_KEY_ID=<iam-user>
AWS_SECRET_ACCESS_KEY=<aws-secrets-manager>

# Logging
LOKI_URL=http://loki:3100
LOG_LEVEL=warn
ALLOWED_ORIGINS=https://api.example.com

# Domain
DOMAIN=api.example.com
```

## Deployment (CI/CD desde GitHub Actions)

**Trigger:** merge to `main` branch (protected, 2 reviews requeridas)

### Workflow

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci && npm run test:coverage
      - run: npm run lint
      - run: npm run build

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm audit
      - uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'

  deploy:
    needs: [test, security]
    runs-on: ubuntu-latest
    environment: production  # Manual approval required
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to EC2
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.PROD_EC2_HOST }}
          username: ec2-user
          key: ${{ secrets.PROD_EC2_KEY }}
          script: |
            cd express-clean-backend
            git fetch origin
            git checkout main
            git pull origin main
            
            # Fetch secrets
            aws secretsmanager get-secret-value \
              --secret-id /app/prod/env \
              --query SecretString \
              --output text | jq -r 'to_entries | .[] | "\(.key)=\(.value)"' > .env.production
            
            # Stop + pull latest
            docker-compose --profile production down
            docker pull app-api:latest
            
            # Start
            docker-compose --profile production up -d
            sleep 5
            
            # Health check
            curl -f https://api.example.com/health || exit 1
            
      - name: Smoke tests
        run: |
          curl -f https://api.example.com/health || exit 1
          curl -f https://api.example.com/metrics | grep http_requests_total || exit 1
```

## Backups & Disaster Recovery

### MongoDB Backups

**Script cron (nightly):**

```bash
#!/bin/bash
# /home/ec2-user/backup-mongo.sh

BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/tmp/mongo_backup_${BACKUP_DATE}.gz"

docker exec mongo-prod mongodump \
  --uri="mongodb://admin:${MONGODB_PASSWORD}@localhost:27017/admin" \
  --archive="${BACKUP_FILE}"

# Upload to S3
aws s3 cp "${BACKUP_FILE}" \
  "s3://app-prod-backups/mongo/${BACKUP_DATE}.gz" \
  --region us-east-1

# Keep only 7 days
aws s3 ls s3://app-prod-backups/mongo/ \
  --region us-east-1 \
  | grep "$(date -d '8 days ago' +%Y%m%d)" \
  | awk '{print $NF}' \
  | xargs -I {} aws s3 rm "s3://app-prod-backups/mongo/{}"

# Cleanup
rm -f "${BACKUP_FILE}"
```

**Cron entry:**
```bash
0 2 * * * /home/ec2-user/backup-mongo.sh
```

### Restore from Backup

```bash
# List backups
aws s3 ls s3://app-prod-backups/mongo/ --region us-east-1

# Download + restore
BACKUP_DATE=20260510_020000
aws s3 cp "s3://app-prod-backups/mongo/${BACKUP_DATE}.gz" /tmp/

docker exec mongo-prod mongorestore \
  --uri="mongodb://admin:${MONGODB_PASSWORD}@localhost:27017/admin" \
  --archive="/tmp/${BACKUP_DATE}.gz"
```

### EBS Snapshots (Infrastructure-level)

```bash
# Create daily snapshot of /dev/sda1
0 3 * * * aws ec2 create-snapshot \
  --volume-id vol-xxxxx \
  --description "api-prod-ebs-$(date +%Y%m%d)" \
  --region us-east-1

# Retain only 14 days (manual or via Lambda)
```

## Monitoreo & Alertas

### CloudWatch

**Logs:** API + Docker logs auto-shipped
**Metrics:** EC2 CPU, Network, Disk (native) + Prometheus metrics via agent

### Alertas (SNS → Email)

```bash
# Create SNS topic
aws sns create-topic --name api-prod-alerts --region us-east-1

# Create CloudWatch alarm: high error rate
aws cloudwatch put-metric-alarm \
  --alarm-name "api-prod-error-rate-high" \
  --alarm-description "API error rate > 5% for 5 minutes" \
  --metric-name "ErrorRate" \
  --namespace "API" \
  --statistic "Average" \
  --period 300 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --alarm-actions "arn:aws:sns:us-east-1:ACCOUNT_ID:api-prod-alerts"
```

### Health checks

```bash
# EC2 status checks (AWS native)
# + Application health check
0 */5 * * * curl -f https://api.example.com/health || aws sns publish \
  --topic-arn arn:aws:sns:us-east-1:ACCOUNT:api-prod-alerts \
  --message "API health check failed at $(date)"
```

## Runbook: Incident Response

### API Crash

```bash
# 1. Diagnose
ssh -i prod-key.pem ec2-user@<ip>
docker logs app-api | tail -100
docker ps -a | grep app

# 2. Restart
docker restart app-api
sleep 10
curl https://api.example.com/health

# 3. Escalate if persists
# → Check logs in CloudWatch
# → Check DB connectivity
# → Check disk space (df -h)
# → Rollback last deployment
```

### DB Connection Pool Exhausted

```bash
# 1. Check connections
docker exec mongo-prod mongosh \
  -u admin -p $MONGODB_PASSWORD \
  --eval "db.currentOp()" | grep -c "active"

# 2. Kill idle connections
docker exec mongo-prod mongosh \
  -u admin -p $MONGODB_PASSWORD \
  --eval "db.adminCommand({ killAllSessions: [] })"

# 3. Increase pool size (if needed)
# Edit .env.production → MONGOOSE_POOL_SIZE
# Restart API
docker restart app-api
```

### Disk Space Low

```bash
# Check
df -h

# Clean Docker images
docker system prune -a -f

# Clean old backups (if local)
rm -rf /tmp/mongo_backup_*.gz

# If still critical: increase EBS volume
# AWS Console → EBS → Extend volume → resize filesystem
```

## Seguridad en Producción

### Secrets Management
- **No hardcoded secrets:** usar AWS Secrets Manager
- **Rotation:** 90 days (implementar Lambda trigger)
- **Audit:** CloudTrail logs acceso a secrets

### Network Isolation
- **Security Group:** inbound solo 22/80/443, outbound only needed
- **VPC:** (futuro) private subnets para RDS/ElastiCache si escalamos
- **VPN:** ssh via bastion host (futuro)

### TLS/SSL
- **Certificado:** Let's Encrypt via Traefik ACME (auto-renew)
- **HSTS:** enabled (Helmet middleware)
- **OCSP Stapling:** auto-enabled Traefik

### Compliance
- **Data retention:** 90 day TTL en loginAuditLogs
- **GDPR:** soft delete enabled, no hard deletes
- **Encryption:** S3 objects encrypted at-rest (SSE-S3)

## Failover & Disaster Recovery Plan

**RPO (Recovery Point Objective):** 1 hora (backup nightly)
**RTO (Recovery Time Objective):** 30 minutos (restore + restart)

### Restore a nuevo EC2 (si instancia muere)

```bash
# 1. Launch new EC2 (same specs)
# 2. Clone repo + install Docker
# 3. Restore latest DB backup
aws s3 cp s3://app-prod-backups/mongo/latest.gz /tmp/
docker exec mongo-prod mongorestore --archive=/tmp/latest.gz

# 4. Start services
docker-compose --profile production up -d

# 5. Update DNS (Route 53) to new IP
# 6. Test
curl https://api.example.com/health
```

## Cost Optimization

- **EC2:** t.micro free tier (~$0 if within limits)
- **S3:** storage + backup lifecycle (delete > 30 days)
- **EBS:** gp3 (cheaper than gp2), delete old snapshots
- **Data transfer:** keep Mongo + API same region (us-east-1)

## Comparación staging vs production

| Aspecto | Staging | Production |
|---|---|---|
| **RTO/RPO** | N/A | 30min / 1hour |
| **Backups** | Manual | Nightly automated |
| **Monitoring** | Basic | 24/7 CloudWatch + SNS |
| **Alerting** | Email | Email + Slack (futuro) |
| **SSL** | ACME | ACME + Pin certs (futuro) |
| **Secrets** | GitHub Secrets | AWS Secrets Manager |

## Referencias

- AWS EC2 guide: [`docs/aws/ec2.md`](../aws/ec2.md)
- AWS Secrets: [`docs/aws/iam.md`](../aws/iam.md)
- Disaster recovery: Standard AWS playbook
