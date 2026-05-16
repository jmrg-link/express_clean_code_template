# Setup Keycloak EC2

Procedimiento de despliegue desde cero. Asume que las phases 01-03 (TF backend,
VPC, KMS workloads) ya están aplicadas.

## Prerequisitos

- Cuenta AWS admin con MFA (no root).
- Zona Cloudflare gestionada con el apex correspondiente.
- API Token Cloudflare con scope mínimo `Zone.DNS:Edit` sobre la zona.
- CloudShell disponible en la región objetivo.

## Variables Terraform

En `infra/aws/envs/main/terraform.tfvars` (gitignored):

```hcl
keycloak_domain         = "<tu-dominio.tld>"
cloudflare_zone_id      = "<zone-id-32-hex>"
keycloak_instance_type    = "t4g.small"
keycloak_ebs_data_size_gb = 20
keycloak_admin_username   = "kcadmin"
```

## Despliegue

```bash
export CLOUDFLARE_API_TOKEN="<token>"
export AWS_REGION=<region>

cd infra/aws/envs/main
terraform init

# Plan acotado a Keycloak + DLM + secrets
terraform plan \
  -target=module.keycloak \
  -target=module.backups \
  -target=aws_secretsmanager_secret.kc_admin \
  -target=aws_secretsmanager_secret_version.kc_admin \
  -target=aws_secretsmanager_secret.kc_client_staging \
  -target=aws_secretsmanager_secret_version.kc_client_staging \
  -target=aws_secretsmanager_secret.kc_client_prod \
  -target=aws_secretsmanager_secret_version.kc_client_prod \
  -target=random_password.kc_admin \
  -target=random_password.kc_client_staging \
  -target=random_password.kc_client_prod \
  -out=tfplan-kc

terraform apply tfplan-kc
```

Tiempo de apply: ~3-5 min (EC2 boot + userdata + Docker pull + import realms).

Outputs relevantes:

```
keycloak_eip                       = "x.x.x.x"
keycloak_instance_id               = "i-xxxxxxxxxxxxxxxxx"
keycloak_url_prod                  = "https://kc.<domain>/realms/app-prod"
keycloak_url_staging               = "https://kc-staging.<domain>/realms/app-staging"
keycloak_admin_secret_arn          = <sensitive>
keycloak_client_prod_secret_arn    = <sensitive>
keycloak_client_staging_secret_arn = <sensitive>
```

## Ajustes Cloudflare manuales tras el apply

Estos pasos NO los hace Terraform y son necesarios:

### 1. Page Rule SSL para hostnames de Keycloak

CF dashboard → Reglas → Reglas de página → Crear:

- URL: `kc*.<domain>/*`
- Setting: `SSL` → `Flexible`

Sin esto, el resto de la zona sigue en `Full` (o el modo que tenga el portfolio)
y CF intentaría hablar HTTPS al origin, que solo expone HTTP.

### 2. WAF managed rules exception

CF dashboard → Seguridad → WAF → Reglas administradas → Agregar excepción:

- Nombre: `skip-bot-on-kc`
- Expresión: `(http.host eq "kc.<domain>") or (http.host eq "kc-staging.<domain>")`
- Acción: `Omitir todas las reglas restantes`

### 3. Super Bot Fight Mode

CF dashboard → Seguridad → Bots → Configurar protección → setting
**Definitivamente automatizado**: `Permitir`.

Sin esto, clientes HTTP automáticos (curl, librerías HTTP server-side) reciben
403 con header `cf-mitigated: challenge`. Una vez phase-04 (API ECS) esté
operativa conviene migrar este bypass a una WAF Custom Rule por hostname para
no exponer otros subdominios.

## Smoke test

```bash
curl -fsSL https://kc-staging.<domain>/realms/app-staging/.well-known/openid-configuration | jq .issuer
# → "https://kc-staging.<domain>/realms/app-staging"

curl -fsSL https://kc.<domain>/realms/app-prod/.well-known/openid-configuration | jq .issuer
# → "https://kc.<domain>/realms/app-prod"
```

## Validación del service account

```bash
CS=$(aws secretsmanager get-secret-value --region <region> \
  --secret-id keycloak/clients/app-api-staging \
  --query SecretString --output text | jq -r .client_secret)

curl -s -X POST https://kc-staging.<domain>/realms/app-staging/protocol/openid-connect/token \
  -d grant_type=client_credentials \
  -d client_id=app-api \
  -d client_secret="$CS" | jq '{token_type, expires_in, has_token: (.access_token | length > 0)}'
```

Esperado:

```json
{
  "token_type": "Bearer",
  "expires_in": 300,
  "has_token": true
}
```

## Gotchas conocidas

| Síntoma | Causa | Fix |
|---|---|---|
| `terraform plan` falla `invalid value for description` en `aws_dlm_lifecycle_policy` | DLM description regex prohíbe `=` | Evitar `=` en el string de description |
| `terraform plan` falla `kms_key_id is an invalid ARN` en `aws_ebs_volume` | EBS espera ARN, no key ID | Usar `var.kms_workloads_arn` (no `_id`) |
| KC container restart loop, log `Disabled option: '--override'` | Flag no válida en KC 26 | Quitar `--override` del compose. `KC_DB_IMPORT_STRATEGY=IGNORE_EXISTING` ya cubre el caso |
| `client_credentials` devuelve `500 unknown_error` con log `Failed to decode URL ...%=... to UTF-8` | El client_secret contiene secuencia ilegal de URL-encoding (`%` no seguido de 2 hex) | Regenerar el secret desde la UI de KC (alfanumérico por defecto) y sincronizar a Secrets Manager. Excluir `%` y `=` de `override_special` en `random_password` |
| `curl` devuelve `HTTP/2 403` con `cf-mitigated: challenge` | Super Bot Fight Mode | Setting `Definitivamente automatizado = Permitir` |
| `curl https://kc-staging...` devuelve `525 SSL handshake fail` | CF en modo `Full` o `Full (strict)` intenta HTTPS al origen | Page Rule SSL → Flexible para `kc*.<domain>/*` |
