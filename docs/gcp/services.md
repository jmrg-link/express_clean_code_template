# Servicios GCP

Servicios GCP relevantes: configuración, setup, mapeo AWS a GCP.

---

## Cloud Run

**Qué es:** Serverless container platform. Ejecutar Docker images sin manejar infraestructura.

**Caso de uso:** Desplegar API Express sin EC2/Kubernetes.

**AWS equiv:** ECS Fargate.

### Configuración

```bash
# 1. Build image
docker build -t api:latest .

# 2. Tag para GCP Artifact Registry
docker tag api:latest gcr.io/PROJECT_ID/api:latest

# 3. Push a registry
docker push gcr.io/PROJECT_ID/api:latest

# 4. Deploy a Cloud Run
gcloud run deploy api \
  --image gcr.io/PROJECT_ID/api:latest \
  --platform managed \
  --region us-central1 \
  --memory 512Mi \
  --cpu 1 \
  --allow-unauthenticated

# 5. Get URL
gcloud run services describe api --platform managed --region us-central1
```

---

## Cloud Storage

**Qué es:** Object storage (S3 equivalent).

**AWS equiv:** S3.

### Configuración

```bash
gsutil mb -l us-central1 gs://app-prod-bucket/
gsutil cors set cors.json gs://app-prod-bucket/
gsutil lifecycle set lifecycle.json gs://app-prod-bucket/
```

---

## Secret Manager

**Qué es:** Gestionar secretos (API keys, passwords).

**AWS equiv:** Secrets Manager.

### Configuración

```bash
echo -n "secret-value" | gcloud secrets create KEYCLOAK_CLIENT_SECRET \
  --data-file=-

gcloud secrets versions access latest --secret="KEYCLOAK_CLIENT_SECRET"
```

---

## Cloud Logging

**Qué es:** Agregación de logs centralizados.

**AWS equiv:** CloudWatch Logs.

Cloud Run automáticamente envía logs. Ver con:

```bash
gcloud logging read "resource.type=cloud_run_revision" --limit=50 --format=json
```

---

## Cloud Monitoring

**Qué es:** Métricas + alerting.

**AWS equiv:** CloudWatch Metrics.

Métricas automáticas en Cloud Run:
- request_count
- request_latencies
- container_memory_utilization
- container_cpu_utilization

---

## Firestore

**Qué es:** NoSQL real-time database. JSON documents, real-time sync.

**AWS equiv:** DynamoDB.

### Configuración

```bash
gcloud firestore databases create --region=us-central1
```

### Node.js

```javascript
import { getFirestore } from 'firebase-admin/firestore';
const db = getFirestore();

await db.collection('users').doc(userId).set({ email: '...' });
const doc = await db.collection('users').doc(userId).get();
```

---

## BigQuery

**Qué es:** Data warehouse. SQL queries on massive datasets.

**AWS equiv:** Athena + Redshift.

### Configuración

```bash
bq mk --dataset app_data
bq query --use_legacy_sql=false 'SELECT * FROM app_data.events WHERE statusCode >= 500'
```

---

## Pricing comparison: AWS vs GCP

| Service | AWS | GCP | Notes |
|---|---|---|---|
| **Serverless compute** | ECS Fargate $50+/mo | Cloud Run $10/mo | GCP 5x cheaper |
| **Storage** | S3 $0.023/GB | Cloud Storage $0.020/GB | Casi igual |
| **Database** | RDS $15/mo | Cloud SQL $5/mo | GCP más barato |
| **Analytics** | Athena $6.25/GB | BigQuery $6.25/GB | Igual, BigQuery tiene 1TB gratis/mo |

---

## Referencias

- [GCP docs](https://cloud.google.com/docs)
- [Cloud Run](https://cloud.google.com/run/docs)
- [Cloud Storage](https://cloud.google.com/storage/docs)
- [Secret Manager](https://cloud.google.com/secret-manager/docs)
- [Cloud Logging](https://cloud.google.com/logging/docs)
- [Pricing calculator](https://cloud.google.com/products/calculator)
