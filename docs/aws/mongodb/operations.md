# MongoDB EC2 — Operations

Runbook de operaciones diarias: acceso shell, conexión Compass desde el laptop admin, backup/restore, rotación de credenciales, troubleshooting.

## Acceso shell admin (SSM Session Manager)

Sin SSH. Sin puerto 22. Requiere AWS CLI + `session-manager-plugin` instalado.

```bash
# instalar plugin (una vez en el laptop)
brew install --cask session-manager-plugin

# abrir sesión interactiva
aws ssm start-session \
  --profile <your-cli-profile> \
  --region <aws-region> \
  --target <instance-id>

# dentro de la sesión
sudo systemctl status mongod
sudo journalctl -u mongod -n 100 --no-pager
```

Para encontrar el `<instance-id>`:
```bash
aws ec2 describe-instances \
  --profile <your-cli-profile> --region <aws-region> \
  --filters "Name=tag:Name,Values=mongo-<env>" "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].InstanceId' --output text
```

## Conexión Compass (laptop → instancia)

Túnel SSM port-forward: `localhost:27017` (laptop) → `127.0.0.1:27017` (EC2 Mongo). Cero exposición pública del puerto 27017.

### Scripts locales (NO se commitean)

Los wrappers `scripts/ssm-mongo-staging.sh` y `scripts/ssm-mongo-prod.sh` viven solo en el laptop del admin. Excluidos vía `.git/info/exclude` por contener instance IDs reales.

Plantilla genérica (si necesitas recrearlos en un nuevo laptop):

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTANCE_ID="${MONGO_<ENV>_INSTANCE_ID:-<instance-id>}"
REGION="${AWS_DEFAULT_REGION:-<aws-region>}"
LOCAL_PORT="${LOCAL_PORT:-27017}"
PROFILE="${AWS_PROFILE:-}"

while getopts "p:h" opt; do
  case $opt in
    p) PROFILE="$OPTARG" ;;
    h) sed -n '2,20p' "$0"; exit 0 ;;
  esac
done

PROFILE_ARGS=()
[ -n "$PROFILE" ] && PROFILE_ARGS=(--profile "$PROFILE")

aws sts get-caller-identity "${PROFILE_ARGS[@]}" --query Arn --output text

exec aws ssm start-session "${PROFILE_ARGS[@]}" \
  --region "${REGION}" \
  --target "${INSTANCE_ID}" \
  --document-name AWS-StartPortForwardingSession \
  --parameters "{\"portNumber\":[\"27017\"],\"localPortNumber\":[\"${LOCAL_PORT}\"]}"
```

Sustituir `<env>`, `<instance-id>`, `<aws-region>`. Hacer ejecutable con `chmod +x`.

### Uso

```bash
# Staging
./scripts/ssm-mongo-staging.sh -p <your-cli-profile>

# Production
./scripts/ssm-mongo-prod.sh -p <your-cli-profile>

# Ambos a la vez (distinto puerto local)
./scripts/ssm-mongo-staging.sh -p <your-cli-profile>                    # localhost:27017
LOCAL_PORT=27018 ./scripts/ssm-mongo-prod.sh -p <your-cli-profile>      # localhost:27018
```

El banner muestra `Caller: arn:aws:iam::<aws-account-id>:user/<cli-user>` para verificar identidad antes del túnel.

### Obtener credenciales del secret

```bash
aws secretsmanager get-secret-value \
  --profile <your-cli-profile> --region <aws-region> \
  --secret-id mongo/<env>/admin \
  --query SecretString --output text | jq
```

Devuelve `{"username":"<admin-user>", "password":"<random-32-chars>"}`.

### Compass connection

Si la pwd no tiene caracteres especiales:
```
mongodb://<admin-user>:<password>@localhost:27017/?authSource=admin
```

Si la pwd tiene `!#$%&*+={}^@/:?`, URL-encode con:
```bash
python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$PWD"
```

Alternativa más simple — Form mode en Compass:
- Host: `localhost:27017`
- Auth method: Username/Password
- Username: `<admin-user>`
- Password: pega sin encoding
- Auth Database: `admin`
- TLS: Off
- Auth Mechanism: SCRAM-SHA-256

## IAM user dedicado para acceso admin

Un user IAM separado del admin general (`<admin-user>`) con MFA — pensado para Compass y operaciones puntuales sin exponer credenciales del root admin.

### Permisos mínimos

Policy `<cli-user>-access-policy` con statements para SSM port-forward + lectura de secrets Mongo:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Resource": "*",
      "Action": [
        "ec2:DescribeInstances",
        "ssm:StartSession",
        "ssm:TerminateSession",
        "ssm:ResumeSession",
        "ssm:DescribeSessions",
        "ssm:GetSession",
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel",
        "secretsmanager:GetSecretValue"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": "arn:aws:kms:<aws-region>:<aws-account-id>:key/<kms-workloads-key-id>"
    }
  ]
}
```

`ssmmessages:*` es imprescindible — sin él, el WebSocket del plugin SSM falla con `403 Server authentication failed`.

`kms:Decrypt` necesario para que el user pueda leer los secrets cifrados con la CMK workloads.

### Configurar profile local

```bash
aws configure --profile <your-cli-profile>
# Access Key ID:  AKIA...
# Secret:         ...
# Region:         <aws-region>
# Format:         json

aws sts get-caller-identity --profile <your-cli-profile>
# arn:aws:iam::<aws-account-id>:user/<cli-user>
```

## Backup manual ad-hoc

Aparte de snapshots EBS automáticos (DLM diario, ver `../cloudwatch.md`):

```bash
# dentro de sesión SSM en la instancia
ADMIN_JSON=$(aws secretsmanager get-secret-value --region <aws-region> --secret-id mongo/<env>/admin --query SecretString --output text)
USR=$(echo "$ADMIN_JSON" | jq -r .username)
PWD=$(echo "$ADMIN_JSON" | jq -r .password)

sudo -u mongod mongodump \
  --username "$USR" --password "$PWD" --authenticationDatabase admin \
  --gzip --archive=/tmp/mongo-$(date +%Y%m%d-%H%M).gz

# subir a S3 backups bucket
aws s3 cp /tmp/mongo-*.gz s3://<backup-bucket>/mongo/<env>/ --sse aws:kms --sse-kms-key-id <kms-key-arn>
rm /tmp/mongo-*.gz
```

## Restore desde dump lógico

```bash
aws s3 cp s3://<backup-bucket>/mongo/<env>/<archive>.gz /tmp/

sudo -u mongod mongorestore \
  --username "$USR" --password "$PWD" --authenticationDatabase admin \
  --drop --gzip --archive=/tmp/<archive>.gz
```

## Restore desde snapshot EBS

```bash
# 1) listar snapshots del DLM
aws ec2 describe-snapshots --region <aws-region> --owner-ids self \
  --filters "Name=tag:Name,Values=mongo-<env>-data" \
  --query 'reverse(sort_by(Snapshots,&StartTime))[:5].[SnapshotId,StartTime]' --output table

# 2) crear volumen desde snapshot
aws ec2 create-volume --region <aws-region> \
  --snapshot-id snap-xxxxx \
  --availability-zone <aws-region>a \
  --volume-type gp3 \
  --encrypted --kms-key-id <kms-key-arn> \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=mongo-<env>-data-restore}]'

# 3) stop EC2 + swap volumen
aws ec2 stop-instances --instance-ids <instance-id>
aws ec2 detach-volume --volume-id <old-vol-id>
aws ec2 attach-volume --volume-id <new-vol-id> --instance-id <instance-id> --device /dev/sdf
aws ec2 start-instances --instance-ids <instance-id>
```

## Restart limpio

```bash
sudo systemctl restart mongod
sudo journalctl -u mongod -n 100 --no-pager
```

Si no arranca: `sudo tail -200 /var/log/mongodb/mongod.log`.

## Rotar password admin

```bash
NEW_PWD=$(openssl rand -base64 32 | tr -d '/=+@' | cut -c1-32)

# 1) cambiar en Mongo
mongosh --quiet --username "$USR" --password "$PWD" --authenticationDatabase admin --eval "
  db.getSiblingDB('admin').changeUserPassword('$USR', '$NEW_PWD')
"

# 2) actualizar Secrets Manager
aws secretsmanager put-secret-value \
  --region <aws-region> \
  --secret-id mongo/<env>/admin \
  --secret-string "{\"username\":\"$USR\",\"password\":\"$NEW_PWD\"}"

# 3) reiniciar clientes con sesión cacheada (Compass, API)
```

Rotación recomendada: cada 6 meses.

## Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| `403 Server authentication failed` al abrir SSM tunnel | Policy del user CLI sin `ssmmessages:*` | Añadir `ssmmessages:Create/Open*Channel` |
| `Access to KMS is not allowed` al leer secret | Falta `kms:Decrypt` sobre la CMK workloads | Añadir statement KMS a la policy |
| `Authentication failed` en Compass | Pwd con caracteres especiales mal URL-encoded | Usar Form mode en lugar de URI |
| `Connection refused` a `localhost:27017` | Túnel SSM caído | Relanzar script SSM |
| `Connection accepted` pero queries lentas | WiredTiger cache pequeño | Verificar `mongod.conf.storage.wiredTiger.engineConfig.cacheSizeGB` |
| CPU al 100% sostenida | Query sin índice | `db.<col>.explain('executionStats')` en mongosh |
| Disk usage 90%+ | Crecimiento o logs sin rotar | `du -sh /var/lib/mongo` + revisar `mongod.log` |

## Monitorización (CloudWatch)

Métricas CW Agent activas en cada instancia:
- `CPUUtilization` (AWS/EC2 default)
- `mem_used_percent` (CW Agent)
- `disk_used_percent` `/var/lib/mongo`, `/`
- `StatusCheckFailed*` (AWS/EC2 default)

Logs:
- `/mongo/<env>` log group → `mongod.log` + `userdata.log`

Alarmas configuradas en `../cloudwatch.md`.

## Lecturas relacionadas

- [`README.md`](./README.md) — overview Mongo
- [`setup.md`](./setup.md) — bootstrap completo
- [`../ec2.md`](../ec2.md) — EC2 general
- [`../secrets-manager.md`](../secrets-manager.md)
- [`../cloudwatch.md`](../cloudwatch.md)
