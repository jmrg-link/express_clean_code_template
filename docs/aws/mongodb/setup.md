# MongoDB EC2 — Setup

Bootstrap reproducible vía Terraform + cloud-init UserData. Aplicable para staging y production. Las diferencias entre entornos vienen por variables del módulo.

## Pre-requisitos

| Recurso | De dónde |
|---|---|
| KMS CMK | módulo `kms` (phase 07) |
| Secret `mongo/<env>/admin` | módulo `secrets` con `random_password` |
| Secret `cloudflare/api-token` | rellenado manual una vez |
| VPC + subnet pública | módulo `vpc` (phase 02) |
| Security Groups | módulo `security-groups` (phase 02) |
| Cloudflare zone | externo (`<your-domain.tld>` ya configurada) |

## Variables del módulo `mongodb-ec2`

```hcl
variable "env"                  { type = string }   # "staging" | "prod"
variable "instance_type"        { type = string }   # t4g.micro | t4g.small
variable "ebs_data_size_gb"     { type = number }   # 10 staging, 20 prod
variable "subnet_id"            { type = string }
variable "vpc_id"               { type = string }
variable "kms_key_arn"          { type = string }
variable "secret_admin_arn"     { type = string }
variable "secret_cf_token_arn"  { type = string }
variable "sg_mongo_id"          { type = string }
variable "sg_admin_id"          { type = string }
variable "domain"               { type = string }   # "<your-domain.tld>"
variable "subdomain"            { type = string }   # "mongo-staging" | "mongo"
variable "admin_email"          { type = string }   # LE registration
variable "cloudflare_zone_id"   { type = string }
variable "snapshot_retention"   { type = number }   # 3 staging, 7 prod
```

## Recursos creados por instancia

1. `aws_iam_role` + `instance_profile` (SSM + CloudWatchAgent + Secrets:GetSecretValue).
2. `aws_ebs_volume` data, gp3, encrypted KMS CMK, tag `Backup=true`.
3. `aws_eip` en VPC.
4. `aws_instance` t4g.* con IMDSv2 obligatorio.
5. `aws_volume_attachment` data → `/dev/sdf`.
6. `aws_eip_association` EIP → instance.
7. `cloudflare_record` A para `mongo[-staging].<your-domain.tld>` (proxied=false).
8. CloudWatch Log Group `/mongo/<env>` cifrado con KMS, retention 14 días.

## UserData cloud-init (resumido)

```bash
#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/userdata.log) 2>&1

ENV="${env}"                        # staging | prod
DOMAIN="${domain}"                  # <your-domain.tld>
SUBDOMAIN="${subdomain}"            # mongo[-staging]
REGION="${aws_region}"
SECRET_ADMIN="${secret_admin_arn}"
SECRET_CF="${secret_cf_token_arn}"

# 1) Updates + tools
dnf -y update
dnf -y install amazon-cloudwatch-agent jq awscli xfsprogs

# 2) Mount data volume on /var/lib/mongo
DEVICE=/dev/nvme1n1
if ! blkid $DEVICE; then mkfs.xfs $DEVICE; fi
mkdir -p /var/lib/mongo
UUID=$(blkid -s UUID -o value $DEVICE)
echo "UUID=$UUID /var/lib/mongo xfs defaults,noatime 0 2" >> /etc/fstab
mount -a

# 3) Install MongoDB 8.0 ARM
cat > /etc/yum.repos.d/mongodb-org-8.0.repo <<EOF
[mongodb-org-8.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/amazon/2023/mongodb-org/8.0/aarch64/
gpgcheck=1
enabled=1
gpgkey=https://pgp.mongodb.com/server-8.0.asc
EOF
dnf -y install mongodb-org
chown -R mongod:mongod /var/lib/mongo

# 4) Certbot DNS-01 con Cloudflare
dnf -y install python3-pip
pip3 install certbot certbot-dns-cloudflare

mkdir -p /etc/letsencrypt
aws secretsmanager get-secret-value --region $REGION \
  --secret-id $SECRET_CF --query SecretString --output text > /etc/letsencrypt/cf.ini
chmod 600 /etc/letsencrypt/cf.ini

certbot certonly --non-interactive --agree-tos \
  --email "${admin_email}" \
  --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cf.ini \
  -d "$SUBDOMAIN.$DOMAIN"

cat /etc/letsencrypt/live/"$SUBDOMAIN.$DOMAIN"/{fullchain.pem,privkey.pem} \
  > /etc/ssl/mongodb.pem
chown mongod:mongod /etc/ssl/mongodb.pem
chmod 400 /etc/ssl/mongodb.pem

# 5) mongod.conf (cacheSizeGB dinámico según tipo de instancia)
CACHE=$( [ "$ENV" = "prod" ] && echo "0.75" || echo "0.25" )
cat > /etc/mongod.conf <<EOF
storage:
  dbPath: /var/lib/mongo
  wiredTiger:
    engineConfig:
      cacheSizeGB: $CACHE
net:
  bindIp: 0.0.0.0
  port: 27017
  tls:
    mode: requireTLS
    certificateKeyFile: /etc/ssl/mongodb.pem
security:
  authorization: enabled
systemLog:
  destination: file
  path: /var/log/mongodb/mongod.log
  logAppend: true
processManagement:
  fork: false
EOF

# 6) Start + seed admin user
systemctl enable mongod
systemctl start mongod
sleep 10

PWD_VAL=$(aws secretsmanager get-secret-value --region $REGION \
  --secret-id $SECRET_ADMIN --query SecretString --output text | jq -r .password)
USR_VAL=$(aws secretsmanager get-secret-value --region $REGION \
  --secret-id $SECRET_ADMIN --query SecretString --output text | jq -r .username)

mongosh --tls --tlsAllowInvalidHostnames --eval "
  db.getSiblingDB('admin').createUser({
    user: '$USR_VAL',
    pwd: '$PWD_VAL',
    roles: [{ role: 'root', db: 'admin' }]
  })
" || true   # idempotent

# 7) Renew cert via cron
cat > /etc/cron.d/certbot-renew <<EOF
0 3 * * * root certbot renew --quiet --deploy-hook 'cat /etc/letsencrypt/live/$SUBDOMAIN.$DOMAIN/{fullchain.pem,privkey.pem} > /etc/ssl/mongodb.pem && systemctl reload mongod'
EOF

# 8) CloudWatch Agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          { "file_path": "/var/log/mongodb/mongod.log",
            "log_group_name": "/mongo/$ENV",
            "log_stream_name": "{instance_id}" }
        ]
      }
    }
  }
}
EOF
systemctl enable --now amazon-cloudwatch-agent
```

## IAM policy inline para la instancia

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": [
        "arn:aws:secretsmanager:<aws-region>:<aws-account-id>:secret:mongo/<env>/admin-*",
        "arn:aws:secretsmanager:<aws-region>:<aws-account-id>:secret:cloudflare/api-token-*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": "<kms_key_arn>"
    }
  ]
}
```

Managed policies adicionales:
- `arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore`
- `arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy`

## Verificación post-apply

```bash
# desde laptop
aws ssm start-session --target <instance-id> --region <aws-region>

# dentro de la sesión
sudo systemctl status mongod          # active (running)
sudo journalctl -u mongod -n 50       # sin errores
mongosh --tls --tlsAllowInvalidHostnames \
  --eval "db.adminCommand('ping')"    # { ok: 1 }
ls -la /etc/letsencrypt/live/         # cert presente
```
