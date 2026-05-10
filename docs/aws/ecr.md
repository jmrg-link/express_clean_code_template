# ECR — Elastic Container Registry

A private Docker image registry on AWS.

## Qué?

ECR is a private Docker registry. Like Docker Hub but on AWS.

## Por qué?

The API runs in containers. Those images need to live somewhere secure, versioned, and controlled by IAM.

## Para qué?

- Guardar imagen Docker de API (app-api:v2.0.0)
- Pull automático en ECS tasks
- Implementar lifecycle policies (delete viejas imágenes)
- Image scanning para vulnerabilidades

## Crear repositorio

```bash
# Crear repo ECR
aws ecr create-repository \
  --repository-name app-api \
  --region us-east-1 \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256 \
  --tags Key=Name,Value=app-api Key=Environment,Value=prod

# Verificar
aws ecr describe-repositories --repository-names app-api
```

**Opciones clave:**
- `scanOnPush=true` — AWS scannea vulnerabilidades automáticamente
- `encryptionType=AES256` — encriptación en reposo

## Login desde CI/CD (GitHub Actions)

```bash
# Generar token de login
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

# Verificar
docker info | grep Registry
```

### En GitHub Actions (OIDC)

```yaml
# .github/workflows/deploy.yml
name: Deploy API

on:
  push:
    branches: [main]

env:
  REGISTRY: ACCOUNT.dkr.ecr.us-east-1.amazonaws.com
  IMAGE: app-api
  AWS_REGION: us-east-1

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write  # Para OIDC
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::ACCOUNT:role/github-actions-role
          aws-region: ${{ env.AWS_REGION }}
      
      - name: Login to ECR
        run: |
          aws ecr get-login-password --region $AWS_REGION | \
            docker login --username AWS --password-stdin $REGISTRY
      
      - name: Build image
        run: |
          docker build -t $REGISTRY/$IMAGE:${{ github.sha }} .
          docker tag $REGISTRY/$IMAGE:${{ github.sha }} $REGISTRY/$IMAGE:latest
      
      - name: Push to ECR
        run: |
          docker push $REGISTRY/$IMAGE:${{ github.sha }}
          docker push $REGISTRY/$IMAGE:latest
      
      - name: Update ECS service
        run: |
          aws ecs update-service \
            --cluster app-cluster \
            --service app-api \
            --task-definition app-api:1 \
            --force-new-deployment
```

## Build y push manual

```bash
# 1. Build imagen con tag
docker build -t app-api:v2.0.0 .

# 2. Tag con ECR registry
docker tag app-api:v2.0.0 ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/app-api:v2.0.0

# 3. Login (si no estás logueado)
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

# 4. Push
docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/app-api:v2.0.0

# 5. Verificar en ECR
aws ecr list-images --repository-name app-api --region us-east-1
```

## Lifecycle policies

Eliminar automáticamente imágenes viejas para ahorrar costos.

```bash
# Policy: mantener últimas 10 imágenes, borrar resto
aws ecr put-lifecycle-policy \
  --repository-name app-api \
  --lifecycle-policy-text '{
    "rules": [
      {
        "rulePriority": 1,
        "description": "Keep last 10 images, delete older",
        "selection": {
          "tagStatus": "tagged",
          "tagPrefixList": ["v"],
          "countType": "imageCountMoreThan",
          "countNumber": 10
        },
        "action": {
          "type": "expire"
        }
      },
      {
        "rulePriority": 2,
        "description": "Delete untagged images older than 7 days",
        "selection": {
          "tagStatus": "untagged",
          "countType": "sinceImagePushed",
          "countUnit": "days",
          "countNumber": 7
        },
        "action": {
          "type": "expire"
        }
      }
    ]
  }'

# Verificar policy
aws ecr describe-lifecycle-policy --repository-name app-api
```

## Image scanning

AWS scannea vulnerabilidades en imágenes (CVE database). Habilitado en crear-repositorio con `scanOnPush=true`.

```bash
# Ver resultados de escaneo
aws ecr describe-image-scan-findings \
  --repository-name app-api \
  --image-id imageTag=v2.0.0

# Output:
# {
#   "imageScanFindings": {
#     "findingSeverityCounts": {
#       "CRITICAL": 0,
#       "HIGH": 2,
#       "MEDIUM": 5,
#       "LOW": 12
#     },
#     "findings": [
#       {
#         "name": "CVE-2024-1234",
#         "severity": "HIGH",
#         "uri": "https://...",
#         "attributes": [...]
#       }
#     ]
#   }
# }
```

**Interpretación:**
- CRITICAL: corregir antes de push a prod
- HIGH: considerar corrección
- MEDIUM/LOW: monitor, no bloquea deploy

Actualizar imagen base si hay CVEs:

```dockerfile
# Dockerfile
# ❌ Viejo
FROM node:20

# ✓ Actualizado
FROM node:22-alpine
```

## Permisos IAM

### Para ECS pull desde ECR

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": "arn:aws:ecr:us-east-1:ACCOUNT:repository/app-api"
    },
    {
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    }
  ]
}
```

Adjuntar a `ecsTaskExecutionRole` (no `ecsTaskRole`).

### Para CI/CD push desde GitHub Actions

```json
{
  "Effect": "Allow",
  "Action": [
    "ecr:GetDownloadUrlForLayer",
    "ecr:BatchGetImage",
    "ecr:PutImage",
    "ecr:InitiateLayerUpload",
    "ecr:UploadLayerPart",
    "ecr:CompleteLayerUpload"
  ],
  "Resource": "arn:aws:ecr:us-east-1:ACCOUNT:repository/app-api"
}
```

## Versionamiento

### Estrategia de tags

```bash
# Tag semántico (recomendado)
docker tag app-api:build ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/app-api:v2.0.0
docker tag app-api:build ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/app-api:v2.0
docker tag app-api:build ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/app-api:v2
docker tag app-api:build ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/app-api:latest

# Push todos
docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/app-api:v2.0.0
docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/app-api:latest

# En ECS task definition: especificar versión exacta
"image": "ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/app-api:v2.0.0"
```

**Nunca usar `latest` en prod** (ambiguo, no reproducible).

## Comparativa: ECR vs Docker Hub vs Artifactory

| Aspecto | ECR | Docker Hub | Artifactory |
|---|---|---|---|
| **Integración AWS** | ✓ | ✗ | Partial |
| **Permisos IAM** | ✓ | ✗ | ✗ |
| **Scanning automático** | ✓ | Free tier no | ✓ |
| **Costo** | $0.07/GB | Free (1 repo privado) | $$$$ (enterprise) |
| **Replicación** | ✓ | ✗ | ✓ |

**Recomendación:** ECR para workloads AWS, Docker Hub si necesitas multi-cloud.

## Costos

| Concepto | Tarifa |
|---|---|
| Almacenamiento | $0.07/GB/mes |
| API calls | Gratis (100 calls/min) |
| **Estimado (5 GB)** | ~$0.35/mes |

## Troubleshooting

### "ImageNotFound" en ECS

```bash
# Verificar que imagen existe en ECR
aws ecr list-images --repository-name app-api

# Si no existe, pushear
docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/app-api:v2.0.0

# Verificar en task definition: nombre exacto
aws ecs describe-task-definition --task-definition app-api:1 \
  | jq '.taskDefinition.containerDefinitions[0].image'
```

### "AccessDenied" en push

```bash
# Verificar credenciales
aws sts get-caller-identity

# Re-login
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.us-east-1.amazonaws.com
```

### Imágenes antiguas ocupan espacio

Aplicar lifecycle policy:

```bash
aws ecr describe-lifecycle-policy --repository-name app-api
# Si no hay policy, crear una (ver sección arriba)
```

## Enlaces relacionados

- [ECS — Container Orchestration](./ecs.md)
- [CI/CD AWS](../ci-cd/aws.md)
- [README AWS](./README.md)
- AWS ECR docs: https://docs.aws.amazon.com/ecr/
- Docker build best practices: https://docs.docker.com/develop/dev-best-practices/
