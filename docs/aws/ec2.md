# EC2 — Instances

Compute self-hosted ARM Graviton (`t4g.*`) sobre Amazon Linux 2023. Tres instancias planificadas: 2 MongoDB (staging + prod) + 1 API Express (futuro). Todas en subnet pública con Security Group estricto y SSM Session Manager para acceso admin (sin SSH abierto).

## Instances overview

| Tag Name | Tipo | RAM | EBS data | Subnet | EIP | Public access | Notas |
|---|---|---|---|---|---|---|---|
| `mongo-staging` | t4g.micro | 1 GB | 10 GB gp3 | public AZ-a | sí | bloqueado 27017 | WiredTiger cache 256 MB |
| `mongo-prod` | t4g.small | 2 GB | 20 GB gp3 | public AZ-a | sí | bloqueado 27017 | WiredTiger cache ~768 MB |
| `api-prod` (futuro) | t4g.micro | 1 GB | — (root 8 GB) | public AZ-a | sí | 80/443 desde IPs Cloudflare | Docker + Caddy reverse proxy |

Total compute IVA: ~34 €/mes (post-API). Detalle en [`README.md`](./README.md#servicios-y-costes-estimados).

## AMI base

Amazon Linux 2023 ARM64. Lookup dinámico via Terraform `data "aws_ami"`:

```hcl
data "aws_ami" "al2023_arm" {
  most_recent = true
  owners      = ["amazon"]
  filter { name = "name", values = ["al2023-ami-2023*-arm64"] }
  filter { name = "architecture", values = ["arm64"] }
  filter { name = "root-device-type", values = ["ebs"] }
}
```

A fecha mayo 2026 en `<aws-region>` la última AMI es kernel 6.18. Verificar:

```bash
aws ec2 describe-images --region <aws-region> --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*-arm64" \
  --query 'reverse(sort_by(Images,&CreationDate))[:3].[ImageId,Name]' --output text
```

## Convenciones para todas las instancias

| Atributo | Valor | Por qué |
|---|---|---|
| `instance_type` | `t4g.*` (ARM) | -30% más barato que x86 equivalente, suficiente para workloads ligeros |
| `metadata_options.http_tokens` | `required` | IMDSv2 obligatorio, anti-SSRF |
| `root_block_device.encrypted` | `true` | EBS encryption con KMS CMK |
| `root_block_device.kms_key_id` | CMK propia | No usar `aws/ebs` managed |
| `iam_instance_profile` | Role mínimo | SSM + CloudWatchAgent + Secrets:Get según necesidad |
| `vpc_security_group_ids` | `[sg-<role>, sg-admin]` | Doble SG: rol funcional + admin (SSM egress) |
| `subnet_id` | Subnet pública AZ-a | Sin NAT Gateway por budget |
| `monitoring` | `true` | CloudWatch detailed disabled (free básico) |
| `tags.Backup` | `true` (solo data volumes) | Activa DLM lifecycle policy |

## IAM Role base (todas las instancias)

```hcl
managed_policy_arns = [
  "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
]
```

Inline policy adicional según rol (Mongo lee secret `mongo/<env>/admin`, API lee múltiples). Detalle en [`secrets-manager.md`](./secrets-manager.md).

## Security Groups (resumen)

| SG | Ingress | Egress | Notas |
|---|---|---|---|
| `sg-mongo` | TCP 27017 desde `sg-api.id` (referencia) | all | Mongo accesible solo desde API EC2 y SSM tunnel |
| `sg-api` | TCP 80/443 desde rangos Cloudflare IPs | all | Frente público vía CF proxy |
| `sg-admin` | (vacío) | all | Solo egress para SSM agent + CW agent |

Detalle completo en [`vpc-network.md`](./vpc-network.md#security-groups).

## Elastic IPs

Cada instancia con EIP fija para que el DNS de Cloudflare no tenga que cambiar en reboots. EIPs son gratis mientras estén asociadas a instancia running.

```hcl
resource "aws_eip" "mongo_prod" {
  domain   = "vpc"
  instance = aws_instance.mongo_prod.id
  tags     = { Name = "eip-mongo-prod" }
}
```

## EBS volumes

| Volume | Tipo | Tamaño | Cifrado | Mount |
|---|---|---|---|---|
| Root mongo-staging | gp3 | 8 GB | KMS CMK | `/` |
| Data mongo-staging | gp3 | 10 GB | KMS CMK | `/var/lib/mongo` |
| Root mongo-prod | gp3 | 8 GB | KMS CMK | `/` |
| Data mongo-prod | gp3 | 20 GB | KMS CMK | `/var/lib/mongo` |
| Root api | gp3 | 8 GB | KMS CMK | `/` |

Data volumes con tag `Backup = true` activan DLM (snapshots diarios). Root sin tag → no se snapshotea (la instancia se puede recrear desde TF).

## Acceso shell admin

**Siempre via SSM Session Manager.** SSH cerrado en SG.

```bash
aws ssm start-session --region <aws-region> --target <instance-id>
```

Razones para preferir SSM sobre SSH:
- Sin abrir puerto 22.
- Autenticación IAM + MFA (no key files).
- Logs auditables en CloudTrail.
- Sin gestión de keys SSH.

## Conexión Compass / mongosh local

Vía SSM port-forward, no DNS público. Detalle en [`mongodb/operations.md`](./mongodb/operations.md#conexión-compass-laptop--instancia).

## Lifecycle típico

1. `terraform apply` crea instancia con UserData cloud-init.
2. cloud-init instala Mongo / Docker, configura TLS, arranca servicio.
3. Healthcheck post-apply: `aws ssm start-session` + `systemctl status`.
4. Monitorización vía CloudWatch.
5. Patching: `dnf update` por SSM Run Command (mensual) — ver [`operations.md`](./mongodb/operations.md).
6. Termination: `terraform destroy` (data volume detach + destroy). Snapshots quedan según DLM retention.

## Decisiones descartadas

| Opción | Por qué no |
|---|---|
| t2/t3.* x86 | ARM Graviton ~30% más barato y aprox mismo rendimiento para Mongo/Node |
| Spot Instances | Workloads stateful no toleran interrupción 2-min |
| Auto Scaling Group | Single instance basta para volumen actual |
| Multi-AZ failover automático | Requiere Replica Set o RDS Multi-AZ, fuera de budget |
| Instance Store ephemeral | Mongo necesita persistencia, EBS obligatorio |

## Lecturas relacionadas

- [`mongodb/`](./mongodb/) — detalle MongoDB
- [`vpc-network.md`](./vpc-network.md) — VPC + SGs
- [`secrets-manager.md`](./secrets-manager.md) — secrets layout
- [`cloudwatch.md`](./cloudwatch.md) — alarmas
- [`iam.md`](./iam.md) — roles e instance profiles
