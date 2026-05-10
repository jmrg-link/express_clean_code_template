# GCP Authentication & Authorization

GCP native IAM: service accounts, roles, Workload Identity Federation for GitHub Actions.

---

## GCP IAM Basics

**IAM = Identity Access Management.**

Modelo: `Principal` + `Role` + `Resource` → `Permission`

### Tipos de identidades

| Tipo | Ejemplo | Usar para |
|---|---|---|
| **User** | user@example.com | Humanos (devs, ops) |
| **Service Account** | api-sa@project.iam.gserviceaccount.com | Apps, CI/CD, Cloud Run |
| **Group** | devs@example.com | Múltiples usuarios |
| **Workload Identity** | GitHub Actions, etc. | CI/CD sin secrets |

### Roles (predefinidos)

| Role | Permisos | Usar para |
|---|---|---|
| `Viewer` | Read-only | Auditoría, monitoring |
| `Editor` | Read + write | Devs, apps |
| `Admin` | Full control | Ops, lead devs |
| `Compute Admin` | Manage Compute Engine, Cloud Run | Deployment |
| `Secret Accessor` | Read secrets | Apps, CI/CD |
| `Artifact Registry Writer` | Push images | CI/CD |

### Custom roles

Crear role personalizado con permisos específicos:

```bash
gcloud iam roles create customCloudRunDeployer \
  --project=PROJECT_ID \
  --title="Custom Cloud Run Deployer" \
  --description="Deploy to Cloud Run, access secrets" \
  --permissions="run.services.update,secretmanager.secrets.get"
```

---

## Service Accounts

**Qué es:** Identidad no-humana para apps, scripts, CI/CD.

### Crear service account

```bash
gcloud iam service-accounts create api-sa \
  --display-name="API Service Account"
```

### Asignar roles

```bash
# Grant Cloud Run Admin
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member=serviceAccount:api-sa@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/run.admin

# Grant Secret Accessor
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member=serviceAccount:api-sa@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

### Crear key (para local dev)

```bash
gcloud iam service-accounts keys create api-sa-key.json \
  --iam-account=api-sa@PROJECT_ID.iam.gserviceaccount.com

# Usar en Node.js
import { Storage } from '@google-cloud/storage';
const storage = new Storage({
  keyFilename: 'api-sa-key.json'
});
```

**Aviso:** guardar key.json en secreto (`.gitignore`).

---

## Workload Identity Federation (GitHub Actions)

**Qué es:** OIDC-based auth. GitHub Actions → GCP sin secrets/keys.

### Setup (una sola vez)

```bash
PROJECT_ID="my-project"
PROJECT_NUMBER=$(gcloud projects list --filter="projectId=$PROJECT_ID" --format='value(projectNumber)')

# 1. Crear Workload Identity Pool
gcloud iam workload-identity-pools create github \
  --project=$PROJECT_ID \
  --location=global \
  --display-name="GitHub Actions"

# 2. Crear OIDC provider
gcloud iam workload-identity-pools providers create-oidc github-oidc \
  --project=$PROJECT_ID \
  --location=global \
  --workload-identity-pool=github \
  --attribute-mapping="google.subject=assertion.sub,attribute.aud=assertion.aud" \
  --issuer-uri=https://token.actions.githubusercontent.com

# 3. Crear service account
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions"

# 4. Grant roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/run.admin

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/artifactregistry.writer

# 5. Setup binding
gcloud iam service-accounts add-iam-policy-binding \
  github-actions@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --principal="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/GITHUB_ORG/GITHUB_REPO"
```

### GitHub Actions workflow

```yaml
name: Deploy

on:
  push:
    branches: [main]

env:
  GCP_PROJECT: my-project
  GCP_REGION: us-central1

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v3

      # Authenticate to GCP (NO secrets needed!)
      - name: Authenticate to GCP
        uses: google-github-actions/auth@v1
        with:
          workload_identity_provider: projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-oidc
          service_account: github-actions@PROJECT_ID.iam.gserviceaccount.com

      # Deploy
      - name: Deploy to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v1
        with:
          service: api
          region: ${{ env.GCP_REGION }}
          image: gcr.io/${{ env.GCP_PROJECT }}/api:${{ github.sha }}
```

**Ventajas:**
- NO hardcode API keys en GitHub
- Tokens short-lived (automáticos)
- Auditoria en GCP: quién deployó, cuándo

---

## Best practices

| Práctica | Por qué | Cómo |
|---|---|---|
| **Least privilege** | Minimizar daño si comprometido | Dar roles específicos, no Admin |
| **Audit logging** | Trazabilidad | Enabler Cloud Audit Logs |
| **Key rotation** | Secrets expiran | Rotar keys cada 90 días |
| **Service account isolation** | Cada app su identity | Crear SA por servicio |
| **Workload Identity** | Eliminar keys | Usar OIDC en CI/CD |
| **MFA/2FA** | Prevenir compromiso | Enable para humanos |

---

## Troubleshooting

| Problema | Solución |
|---|---|
| **"Permission denied" error** | Chequear roles via `gcloud projects get-iam-policy PROJECT_ID` |
| **"Service account not found"** | Crear con `gcloud iam service-accounts create` |
| **"Key file not valid"** | Regenerar key: `gcloud iam service-accounts keys create` |
| **"GitHub Actions auth failing"** | Verificar Workload Identity Pool + binding via `gcloud iam ...` |

---

## Referencias

- [GCP IAM docs](https://cloud.google.com/iam/docs)
- [Service accounts](https://cloud.google.com/iam/docs/service-accounts)
- [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation)
- [GitHub Actions auth](https://github.com/google-github-actions/auth)
