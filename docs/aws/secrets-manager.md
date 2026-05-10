# Secrets Manager — Secrets

Encrypted secret storage with automatic rotation.

## Qué?

Secrets Manager stores passwords and API keys encrypted. Automatically rotate them too.

## Por qué?

`.env.production` has sensitive data. Git = public. Secrets Manager encrypts everything, rotates automatically, and audits who touches what.

## Para qué?

- Almacenar `MONGODB_PASSWORD`, `JWT_SECRET`, `AWS_ACCESS_KEY_ID`
- Inyectar en tasks ECS automáticamente
- Rotar sin downtime

## Setup inicial

### Crear secreto en Secrets Manager

```bash
# Crear secret con valores
aws secretsmanager create-secret \
  --name /app/prod/env \
  --description "Production environment variables for express-clean-backend" \
  --kms-key-id alias/aws/secretsmanager \
  --secret-string '{
    "MONGODB_URI": "mongodb://admin:mypassword@localhost:27017/app?authSource=admin",
    "MONGODB_PASSWORD": "mypassword",
    "JWT_SECRET": "your-256-bit-secret-key",
    "KEYCLOAK_URL": "https://kc.example.com",
    "KEYCLOAK_REALM": "<keycloak-realm>",
    "AWS_S3_BUCKET": "app-prod-bucket",
    "AWS_REGION": "us-east-1"
  }'

# Verificar
aws secretsmanager describe-secret --secret-id /app/prod/env
aws secretsmanager get-secret-value --secret-id /app/prod/env | jq .SecretString
```

### Actualizar valores

```bash
# Update secret
aws secretsmanager update-secret \
  --secret-id /app/prod/env \
  --secret-string '{...JSON con nuevos valores...}'

# Ver versión anterior
aws secretsmanager list-secret-version-ids --secret-id /app/prod/env
```

## Inyectar en ECS

Task definition puede referenciar secrets sin exponerlos.

```json
{
  "containerDefinitions": [
    {
      "name": "api",
      "secrets": [
        {
          "name": "MONGODB_URI",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:/app/prod/env:MONGODB_URI::"
        },
        {
          "name": "JWT_SECRET",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:/app/prod/env:JWT_SECRET::"
        },
        {
          "name": "AWS_S3_BUCKET",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:/app/prod/env:AWS_S3_BUCKET::"
        }
      ],
      "logConfiguration": {...}
    }
  ]
}
```

**Importante:** `valueFrom` debe tener permiso en `ecsTaskExecutionRole`:

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

## Inyectar en EC2

### Vía AWS CLI durante bootstrap

```bash
#!/bin/bash
# user-data script en EC2

aws secretsmanager get-secret-value \
  --secret-id /app/prod/env \
  --query SecretString \
  --output text | jq -r 'to_entries | .[] | "\(.key)=\(.value)"' > .env.production

# Ahora .env.production tiene todas las variables
docker-compose up -d
```

### Vía IAM Role

EC2 necesita permiso para leer secretos:

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:/app/prod/*"
}
```

## Rotación automática

Cambiar contraseña sin downtime (ej. MongoDB password cada 30 días).

### Lambda function de rotación

```python
# lambda_rotation.py
import boto3
import json
import pymongo
import os

client = boto3.client('secretsmanager')
mongo_client = pymongo.MongoClient

def lambda_handler(event, context):
    secret_id = event['SecretId']
    token = event['ClientRequestToken']
    step = event['Step']
    
    if step == "create":
        # Generar nueva contraseña
        new_password = generate_random_password(32)
        client.put_secret_value(
            SecretId=secret_id,
            ClientRequestToken=token,
            SecretString=json.dumps({
                **get_current_secret(secret_id),
                'MONGODB_PASSWORD': new_password
            }),
            VersionStages=['AWSPENDING']
        )
    
    elif step == "set":
        # Aplicar en MongoDB
        mongo = pymongo.MongoClient(...)
        mongo.admin.command('updateUser', 'admin', pwd=new_password)
        
        client.update_secret_version_stage(
            SecretId=secret_id,
            VersionStages=['AWSCURRENT'],
            MoveToVersionId=token,
            RemoveFromVersionId=get_version_id(...)
        )
    
    return {'statusCode': 200}

def generate_random_password(length=32):
    import secrets
    import string
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))
```

### Habilitar rotación

```bash
# Crear role para Lambda
aws iam create-role --role-name SecretsManagerRotationRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Adjuntar policies
aws iam attach-role-policy --role-name SecretsManagerRotationRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Habilitar rotación en secret
aws secretsmanager rotate-secret \
  --secret-id /app/prod/env \
  --rotation-rules AutomaticallyAfterDays=30
```

## Comparativa: Secrets Manager vs SSM Parameter Store

| Aspecto | Secrets Manager | Parameter Store |
|---|---|---|
| **Encryption** | KMS (default) | KMS (optional) |
| **Rotación automática** | ✓ | ✗ |
| **Auditoría** | CloudTrail | CloudTrail |
| **Costo** | $0.4/secret/mes | Free (Standard tier) |
| **Versioning** | Automático | Manual |
| **Caso de uso** | DB passwords, API keys | Config variables, flags |

**Decisión:** usar Secrets Manager para `.env.production` (sensible), Parameter Store para config (no sensible).

## Costos

- **$0.40/secret/mes** → ~$4.80/año por 1 secret
- **$0.05 por 10k API calls** → generalmente < $1/mes
- **Gratis:** KMS encryption (shared key)

**Total:** ~$5/mes para 1 secret.

## Troubleshooting

### "User: ... is not authorized to perform: secretsmanager:GetSecretValue"

Role no tiene permisos. Verificar policy en IAM role:

```bash
# Si es ECS task role
aws iam get-role-policy --role-name ecsTaskRole --policy-name ReadSecrets

# Si es EC2 instance role
aws iam get-role-policy --role-name ec2-instance-role --policy-name ReadSecrets
```

### "InvalidRequestException: A version with label AWSCURRENT does not exist"

Rotación no completó. Revisar Lambda logs:

```bash
aws logs tail /aws/lambda/rotate-secret --follow
```

### Secret no visible en CLI pero sí en Console

Permiso de `IAM ListSecrets` falta:

```bash
aws secretsmanager list-secrets  # Si falla, agregar policy

# Agregar permisos mínimos
aws iam put-user-policy --user-name admin \
  --policy-name SecretsManagerAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["secretsmanager:*"],
      "Resource": "*"
    }]
  }'
```

## Enlaces relacionados

- [ECS — Container Orchestration](./ecs.md)
- [EC2 — Compute Instances](./ec2.md)
- [IAM — Access Control](./iam.md)
- [README AWS](./README.md)
- AWS Secrets Manager docs: https://docs.aws.amazon.com/secretsmanager/
- AWS Parameter Store docs: https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html
