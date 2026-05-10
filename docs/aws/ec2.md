# EC2 — Compute Instances

Run the API and MongoDB in Docker containers on EC2.

## Instance Types

| Entorno | Type | vCPU | RAM | EBS | Free Tier | Costo/mes |
|---|---|---|---|---|---|---|
| Staging | t2.micro | 1 | 1 GB | 20 GB | Sí | ~$0 |
| Production | t2.micro | 1 | 1 GB | 50 GB | Sí | ~$8.50 |

**Roadmap:** t3a.small (2 vCPU, 2 GB RAM) si necesitamos performance.

## Launch EC2 Instance

```bash
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t2.micro \
  --key-name my-key \
  --security-groups api-sg \
  --monitoring Enabled=true \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=api-prod}]'
```

## Security Group

```bash
# Create
aws ec2 create-security-group \
  --group-name api-sg \
  --description "API instance security"

# Allow SSH
aws ec2 authorize-security-group-ingress \
  --group-name api-sg \
  --protocol tcp \
  --port 22 \
  --cidr OFFICE_IP/32

# Allow HTTP/HTTPS
aws ec2 authorize-security-group-ingress \
  --group-name api-sg \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
  --group-name api-sg \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0
```

## User Data (Bootstrap)

Script que corre al lanzar instancia:

```bash
#!/bin/bash
set -e

# Update
sudo yum update -y
sudo yum install -y docker git curl

# Docker daemon
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user

# Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Clone repo
git clone https://github.com/jmrg/express-clean-backend.git
cd express-clean-backend

# Fetch secrets
aws secretsmanager get-secret-value \
  --secret-id /app/prod/env \
  --query SecretString \
  --output text | jq -r 'to_entries | .[] | "\(.key)=\(.value)"' > .env.production

# Start services
docker-compose --profile production up -d

# Health check
sleep 10
curl -f http://localhost:3000/health || exit 1
```

## MongoDB in Docker

Check logs, backup, restore:

```bash
docker logs mongo-prod

docker exec mongo-prod mongodump \
  -u admin -p $MONGODB_PASSWORD \
  --archive=/tmp/backup.gz --gzip

docker exec mongo-prod mongorestore \
  -u admin -p $MONGODB_PASSWORD \
  --archive=/tmp/backup.gz --gzip
```

## EBS Snapshots

```bash
# Create snapshot
aws ec2 create-snapshot \
  --volume-id vol-xxxxx \
  --description "api-prod-$(date +%Y%m%d)"

# List snapshots
aws ec2 describe-snapshots --owner-ids self

# Restore (create volume from snapshot)
aws ec2 create-volume \
  --snapshot-id snap-xxxxx \
  --availability-zone us-east-1a
```

## Monitoring

CloudWatch metrics (built-in):
- CPU utilization
- Network in/out
- EBS read/write
- Status checks

```bash
# Get metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=i-xxxxx \
  --start-time 2026-05-09T00:00:00Z \
  --end-time 2026-05-10T00:00:00Z \
  --period 3600 \
  --statistics Average
```

## Connection

```bash
ssh -i my-key.pem ec2-user@<public-ip>
```

## Troubleshooting

### Instance won't start
```bash
aws ec2 describe-instance-status --instance-ids i-xxxxx
# Check "InstanceStatus" and "SystemStatus"
```

### Out of disk space
```bash
# Extend EBS volume
# AWS Console → Volumes → Modify
# Then resize filesystem
sudo resize2fs /dev/xvda1
```

### Can't connect via SSH
```bash
# Check security group allows port 22
aws ec2 describe-security-groups --group-ids sg-xxxxx

# Check instance public IP
aws ec2 describe-instances --instance-ids i-xxxxx \
  --query 'Reservations[0].Instances[0].PublicIpAddress'
```

## MongoDB Containerizado (Docker)

EC2 aloja MongoDB en container para staging + prod. Alternativa: usar MongoDB Atlas (managed, más caro).

### docker-compose.yml en EC2

```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:8.2
    container_name: mongo-prod
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: ${MONGODB_PASSWORD}
    volumes:
      - mongo_data:/data/db
      - mongo_config:/data/configdb
    restart: always
    networks:
      - app-network

  api:
    image: node:22-alpine
    container_name: api-prod
    working_dir: /app
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      MONGODB_URI: mongodb://admin:${MONGODB_PASSWORD}@mongodb:27017/app?authSource=admin
      KEYCLOAK_URL: ${KEYCLOAK_URL}
      JWT_SECRET: ${JWT_SECRET}
      AWS_S3_BUCKET: app-prod-bucket
      AWS_REGION: us-east-1
    volumes:
      - .:/app
    depends_on:
      - mongodb
    restart: always
    networks:
      - app-network

volumes:
  mongo_data:
  mongo_config:

networks:
  app-network:
    driver: bridge
```

### Iniciar MongoDB

```bash
# Login a EC2
ssh -i my-key.pem ec2-user@<public-ip>

# Clonar repo
git clone https://github.com/jmrg/express-clean-backend.git
cd express-clean-backend

# Fetch secretos desde Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id /app/prod/env \
  --query SecretString \
  --output text > .env.production

# Iniciar con Docker Compose
docker-compose --profile production up -d

# Verificar
docker ps
docker logs mongo-prod
```

### Backup MongoDB

```bash
# Dentro del container
docker exec mongo-prod mongodump \
  -u admin -p $MONGODB_PASSWORD \
  --archive=/tmp/backup-$(date +%Y%m%d-%H%M%S).gz \
  --gzip

# Copiar a S3
docker exec mongo-prod aws s3 cp /tmp/backup-*.gz \
  s3://app-prod-backups/mongo/$(date +%Y/%m/%d)/ \
  --recursive
```

### Restore MongoDB

```bash
# Desde S3
aws s3 cp s3://app-prod-backups/mongo/2026/05/10/backup-20260510-000000.gz \
  /tmp/backup.gz

# Restore
docker exec mongo-prod mongorestore \
  -u admin -p $MONGODB_PASSWORD \
  --archive=/tmp/backup.gz \
  --gzip
```

## EBS Snapshots (Backup de disco completo)

```bash
# Listar volumes
aws ec2 describe-volumes \
  --filters "Name=attachment.instance-id,Values=i-prodapi" \
  --query 'Volumes[*].[VolumeId,Size,State]' \
  --output table

# Crear snapshot
aws ec2 create-snapshot \
  --volume-id vol-abc123 \
  --description "api-prod-mongo-backup-$(date +%Y%m%d)"

# Monitorear progreso
aws ec2 describe-snapshots \
  --owner-ids self \
  --query 'Snapshots[?VolumeSize==`50`].[SnapshotId,Progress,State]' \
  --output table

# Restaurar a nuevo volume
aws ec2 create-volume \
  --snapshot-id snap-abc123 \
  --availability-zone us-east-1a

# Attach a instancia (requiere downtime)
aws ec2 attach-volume \
  --volume-id vol-new123 \
  --instance-id i-prodapi \
  --device /dev/sdf
```

## Monitoring CloudWatch

```bash
# Métricas básicas (sin agent)
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=i-prodapi \
  --start-time 2026-05-09T00:00:00Z \
  --end-time 2026-05-10T00:00:00Z \
  --period 300 \
  --statistics Average,Maximum

# Crear alarma: alerta si CPU > 80%
aws cloudwatch put-metric-alarm \
  --alarm-name api-prod-high-cpu \
  --alarm-description "Alert if EC2 CPU > 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/EC2 \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:alerts

# Crear alarma: alerta si Status Checks fallan
aws cloudwatch put-metric-alarm \
  --alarm-name api-prod-status-checks \
  --alarm-description "Alert if Status Checks fail" \
  --metric-name StatusCheckFailed \
  --namespace AWS/EC2 \
  --statistic Maximum \
  --period 60 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold
```

## VPC + Security Groups

```bash
# Ver security groups
aws ec2 describe-security-groups --query 'SecurityGroups[*].[GroupId,GroupName,InboundRules]'

# Permitir SSH solo desde tu IP
aws ec2 authorize-security-group-ingress \
  --group-id sg-api \
  --protocol tcp \
  --port 22 \
  --cidr 203.0.113.5/32  # Tu IP pública

# Permitir Traefik (443, 80) desde Internet
aws ec2 authorize-security-group-ingress \
  --group-id sg-api \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
  --group-id sg-api \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0

# Permitir MongoDB solo desde contenedor API (intra-EC2)
aws ec2 authorize-security-group-ingress \
  --group-id sg-mongodb \
  --protocol tcp \
  --port 27017 \
  --source-group sg-api

# Listar reglas actuales
aws ec2 describe-security-groups --group-ids sg-api \
  --query 'SecurityGroups[0].IpPermissions[*]'
```

## Troubleshooting

### Instance no responde SSH

```bash
# Verificar status
aws ec2 describe-instance-status --instance-ids i-prodapi

# Revisar security group: ¿permite puerto 22?
aws ec2 describe-security-groups --group-ids sg-api \
  | grep -A 20 "IpPermissions"

# Reboot (si todavía es alcanzable)
aws ec2 reboot-instances --instance-ids i-prodapi

# Stop + Start (si reboot no funciona)
aws ec2 stop-instances --instance-ids i-prodapi
aws ec2 wait instance-stopped --instance-ids i-prodapi
aws ec2 start-instances --instance-ids i-prodapi
```

### Disco lleno

```bash
# Dentro de EC2
df -h

# Limpiar Docker volumes
docker system prune -a --volumes

# Si aún lleno: extend EBS
# AWS Console → Volumes → Modify volume (ej. 50 GB → 100 GB)

# Luego en EC2, expandir filesystem
sudo resize2fs /dev/xvda1
df -h  # verificar
```

### MongoDB no conecta

```bash
# Revisar container
docker logs mongo-prod

# Revisar credenciales en .env.production
cat .env.production | grep MONGODB

# Conectar directamente
docker exec mongo-prod mongo -u admin -p $MONGODB_PASSWORD --authenticationDatabase admin
```

## Cost

| Componente | Costo |
|---|---|
| EC2 t2.micro (free tier) | $0/mes (año 1), $8.50/mes luego |
| EBS 50 GB | $5/mes |
| Data transfer out | $0.09/GB (generalmente gratis en free tier) |
| CloudWatch logs | $0.50/GB ingested |
| **Total** | ~$0/mes (free tier), ~$14/mes luego |

**Futuro:** migrar a ECS Fargate (~$50/mes pero sin ops).

## Enlaces relacionados

- [ECS — Container Orchestration](./ecs.md)
- [Secrets Manager — Secretos](./secrets-manager.md)
- [CloudWatch — Monitoring](./cloudwatch.md)
- [README AWS](./README.md)
- AWS EC2 docs: https://docs.aws.amazon.com/ec2/
- MongoDB Docker: https://hub.docker.com/_/mongo
