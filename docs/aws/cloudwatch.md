# CloudWatch — Logs and Metrics

Centralized logs, metrics, and alarms.

## Qué?

CloudWatch collects logs from everything and stores metrics.

## Por qué?

Running blind in production is a bad idea. You need to know when things fail, what they're using, and get alerted before disaster hits.

## Para qué?

- Logs centralizados (EC2, ECS, Lambda)
- Métricas de performance (CPU, memory, latency)
- Alertas (high CPU, errors > threshold)
- Dashboards para monitoreo visual

## Logs en CloudWatch

### Desde ECS (automático)

Task definition especifica log driver:

```json
{
  "logConfiguration": {
    "logDriver": "awslogs",
    "options": {
      "awslogs-group": "/ecs/app-api",
      "awslogs-region": "us-east-1",
      "awslogs-stream-prefix": "ecs",
      "awslogs-datetime-format": "%Y-%m-%d %H:%M:%S"
    }
  }
}
```

Logs se envían automáticamente a `/ecs/app-api` log group.

### Desde EC2 (manual)

EC2 no envía logs automáticamente. Opciones:

**Opción 1: CloudWatch Agent**
```bash
# Instalar agent en EC2
wget https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
sudo rpm -U ./amazon-cloudwatch-agent.rpm

# Configurar (/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json)
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/containers/api/*.log",
            "log_group_name": "/ec2/app-api",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  }
}

# Iniciar agent
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a query -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s
```

**Opción 2: Docker log driver (recomendado)**
```yaml
# docker-compose.yml
services:
  api:
    logging:
      driver: awslogs
      options:
        awslogs-group: /ec2/app-api
        awslogs-region: us-east-1
        awslogs-stream-prefix: docker
```

### Ver logs via CLI

```bash
# Ver últimas 100 líneas
aws logs tail /ecs/app-api --max-items 100

# Seguir en tiempo real
aws logs tail /ecs/app-api --follow

# Filtrar por patrón
aws logs filter-log-events \
  --log-group-name /ecs/app-api \
  --filter-pattern "ERROR"

# Estadísticas
aws logs describe-log-groups
aws logs describe-log-streams --log-group-name /ecs/app-api
```

## Métricas

### Métricas automáticas (EC2 y ECS)

CloudWatch recolecta sin configuración adicional:

**EC2:**
- `CPUUtilization` (%)
- `NetworkIn/Out` (bytes)
- `DiskReadBytes`, `DiskWriteBytes`
- `StatusCheckFailed` (system/instance)

**ECS:**
- `CPUUtilization` (%)
- `MemoryUtilization` (%)
- `ServiceCount` (running tasks)

```bash
# Consultar métrica
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=app-api Name=ClusterName,Value=app-cluster \
  --start-time 2026-05-09T00:00:00Z \
  --end-time 2026-05-10T00:00:00Z \
  --period 300 \
  --statistics Average,Maximum,Minimum
```

### Métricas custom (desde aplicación)

Express API puede enviar métricas custom:

```typescript
// src/infrastructure/monitoring/cloudwatch.adapter.ts

import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

export class CloudWatchAdapter {
  private client = new CloudWatchClient({ region: 'us-east-1' });

  async putMetric(
    namespace: string,
    metricName: string,
    value: number,
    unit: string = 'None',
  ) {
    const params = {
      Namespace: namespace,
      MetricData: [
        {
          MetricName: metricName,
          Value: value,
          Unit: unit,
          Timestamp: new Date(),
          Dimensions: [
            {
              Name: 'Environment',
              Value: 'production',
            },
          ],
        },
      ],
    };

    await this.client.send(new PutMetricDataCommand(params));
  }
}

// Uso en use-case
export class CreateUserUseCase {
  async execute(input: CreateUserInput): Promise<CreateUserOutput> {
    const startTime = Date.now();
    
    const user = await this.userRepository.create(input);
    
    const duration = Date.now() - startTime;
    await this.cloudwatch.putMetric(
      'ExpressAPI',
      'CreateUserDuration',
      duration,
      'Milliseconds',
    );
    
    return user;
  }
}
```

## Alarms

Alertar cuando algo anda mal.

### Alarm por CPU alta en ECS

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name app-api-high-cpu \
  --alarm-description "Alert if ECS task CPU > 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ServiceName,Value=app-api Name=ClusterName,Value=app-cluster \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:alerts \
  --evaluation-periods 2 \
  --datapoints-to-alarm 2
```

### Alarm por errores en logs

```bash
# Crear metric filter primero
aws logs put-metric-filter \
  --log-group-name /ecs/app-api \
  --filter-name ErrorCount \
  --filter-pattern "[ERROR]" \
  --metric-transformations metricName=Errors,metricValue=1,defaultValue=0

# Luego alarm
aws cloudwatch put-metric-alarm \
  --alarm-name app-api-high-errors \
  --alarm-description "Alert if error count > 10 per 5 min" \
  --metric-name Errors \
  --namespace /ecs/app-api \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:alerts
```

### Alarm por health check failures (ECS)

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name app-api-unhealthy \
  --alarm-description "Alert if tasks failing health checks" \
  --metric-name HealthyTaskCount \
  --namespace AWS/ECS \
  --statistic Average \
  --period 60 \
  --threshold 1 \
  --comparison-operator LessThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:alerts
```

## SNS Notifications

Alarms disparan SNS topics (email, SMS, Slack, etc.).

### Crear topic SNS

```bash
# Crear topic
aws sns create-topic --name alerts

# Suscribir email
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:ACCOUNT:alerts \
  --protocol email \
  --notification-endpoint devops@example.com

# Verificar suscripción (confirmar email)
```

### Integración con Slack (vía Lambda)

```python
# lambda_slack_notification.py
import json
import boto3
import requests

def lambda_handler(event, context):
    # Parse SNS message
    message = json.loads(event['Records'][0]['Sns']['Message'])
    
    # Format para Slack
    slack_message = {
        'text': f"CloudWatch Alert: {message['AlarmName']}",
        'attachments': [
            {
                'color': 'danger' if 'ALARM' in message['NewStateValue'] else 'good',
                'fields': [
                    {'title': 'Alarm', 'value': message['AlarmName']},
                    {'title': 'Reason', 'value': message['NewStateReason']},
                ]
            }
        ]
    }
    
    # Enviar a Slack
    requests.post(
        'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
        json=slack_message,
    )
    
    return {'statusCode': 200}
```

## Dashboards

Visualizar métricas clave en un dashboard.

```bash
aws cloudwatch put-dashboard \
  --dashboard-name app-api-overview \
  --dashboard-body '{
    "widgets": [
      {
        "type": "metric",
        "properties": {
          "metrics": [
            ["AWS/ECS", "CPUUtilization", {"stat": "Average"}],
            ["AWS/ECS", "MemoryUtilization", {"stat": "Average"}]
          ],
          "period": 300,
          "stat": "Average",
          "region": "us-east-1",
          "title": "Service Health"
        }
      },
      {
        "type": "log",
        "properties": {
          "query": "fields @timestamp, @message | filter @message like /ERROR/ | stats count() by bin(5m)",
          "region": "us-east-1",
          "title": "Error Rate (5 min bins)"
        }
      }
    ]
  }'

# Ver dashboard
open "https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=app-api-overview"
```

## Log Insights (Queries)

CloudWatch Logs Insights permite queries SQL-like en logs.

```bash
# Query: errores por endpoint (últimas 24 horas)
aws logs start-query \
  --log-group-name /ecs/app-api \
  --start-time $(date -d '24 hours ago' +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message, endpoint | filter @message like /ERROR/ | stats count() by endpoint'

# Ver resultados
aws logs get-query-results --query-id <query-id>
```

Ejemplos de queries útiles:

```sql
-- Latencia P95 por endpoint
fields @duration, endpoint | stats pct(@duration, 95) as p95_latency by endpoint

-- Top 10 errores
fields @message | filter ispresent(error) | stats count() by error | sort count() desc | limit 10

-- Tasa de error por minuto
fields @timestamp, @message | filter @message like /ERROR/ | stats count() as errors by bin(1m)

-- Usuarios activos
fields userId | stats count_distinct(userId) as active_users
```

## Retención de logs

Evitar costos de almacenamiento excesivos.

```bash
# Establecer retención: 7 días
aws logs put-retention-policy \
  --log-group-name /ecs/app-api \
  --retention-in-days 7

# Opciones: 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653

# Ver retención actual
aws logs describe-log-groups --log-group-name-prefix /ecs/app-api
```

**Recomendación:** 
- Prod: 30 días
- Staging: 7 días
- Archive a S3 después de cierto tiempo (Athena para queries históricas)

## Costos

| Concepto | Tarifa |
|---|---|
| Log ingestion | $0.50/GB |
| Log storage | $0.03/GB/mes |
| Metric (custom) | $0.10/metric |
| API calls | Gratis |
| **Estimado (10 GB/mes logs + 5 metrics)** | ~$6.50/mes |

**Dentro free tier:** 5 GB logs gratis.

## Troubleshooting

### Logs no aparecen en CloudWatch

```bash
# Verificar log group existe
aws logs describe-log-groups --log-group-name-prefix /ecs/app-api

# Verificar log streams
aws logs describe-log-streams --log-group-name /ecs/app-api

# Si ECS: verificar task execution role tiene permisos
aws iam get-role-policy --role-name ecsTaskExecutionRole --policy-name logs-policy
```

Permisos necesarios:
```json
{
  "Effect": "Allow",
  "Action": [
    "logs:CreateLogGroup",
    "logs:CreateLogStream",
    "logs:PutLogEvents"
  ],
  "Resource": "arn:aws:logs:us-east-1:ACCOUNT:log-group:/ecs/*"
}
```

### Alarm no dispara

```bash
# Verificar estado
aws cloudwatch describe-alarms --alarm-names app-api-high-cpu

# Verificar si tema SNS existe
aws sns list-topics

# Test alarm
aws cloudwatch set-alarm-state \
  --alarm-name app-api-high-cpu \
  --state-value ALARM \
  --state-reason "Testing"
```

### Query Insights muy lenta

Usar `limit` y filtros específicos:

```sql
-- ❌ Lento: sin filter, todas las líneas
fields @message

-- ✓ Rápido: con filtro y limit
fields @message | filter @message like /ERROR/ | limit 1000
```

## Enlaces relacionados

- [ECS — Container Orchestration](./ecs.md)
- [EC2 — Compute Instances](./ec2.md)
- [README AWS](./README.md)
- AWS CloudWatch docs: https://docs.aws.amazon.com/cloudwatch/
- CloudWatch Logs Insights query syntax: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html
