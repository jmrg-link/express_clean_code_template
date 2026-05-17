# Operations Keycloak

Procedimientos operativos rutinarios para el Keycloak desplegado en EC2.

## Acceso admin

### UI browser

```
https://kc.<domain>/admin/
```

Credenciales desde Secrets Manager:

```bash
aws secretsmanager get-secret-value --region <region> \
  --secret-id keycloak/admin --query SecretString --output text | jq
```

### Shell en el host

SSM Session Manager (sin SSH, autenticado por IAM):

```bash
INSTANCE_ID=$(aws ec2 describe-instances --region <region> \
  --filters "Name=tag:Name,Values=keycloak-main" \
  --query 'Reservations[].Instances[].InstanceId' --output text)

aws ssm start-session --target $INSTANCE_ID --region <region>
```

Una vez dentro:

```bash
docker compose -f /opt/keycloak/docker-compose.yml ps
docker compose -f /opt/keycloak/docker-compose.yml logs --tail 100 keycloak
```

## Regenerar client_secret

Cuando un secret se compromete (logs, chat, screenshot accidental) o por
rotación rutinaria:

1. UI admin → selector arriba izquierda → cambia al realm afectado (`app-staging` o `app-prod`).
2. Menú izquierda → Clients → `app-api` → tab **Credentials**.
3. Botón **Regenerate** → confirmar.
4. Copiar el nuevo secret (URL-safe por defecto en KC 26).
5. Sincronizar a Secrets Manager:

```bash
read -rsp "Nuevo secret: " NEW_CS && export NEW_CS && echo ""

aws secretsmanager put-secret-value --region <region> \
  --secret-id keycloak/clients/app-api-<env> \
  --secret-string "$(jq -nc \
    --arg c app-api \
    --arg s "$NEW_CS" \
    '{client_id:$c, client_secret:$s}')"
```

Repetir por cada realm.

## Rotar password admin

KC mantiene los users en H2, no en Secrets Manager. El secret AWS solo cubre
el bootstrap inicial.

1. Login admin como `kcadmin` con el password actual.
2. UI superior derecha → avatar → **Manage account**.
3. Tab **Signing in** → Password → **Update** → nuevo password (generador local: `openssl rand -base64 24 | tr -d '=/+'`).
4. Sincronizar el nuevo valor a Secrets Manager:

```bash
read -rsp "Nuevo password admin: " NEW_PWD && export NEW_PWD && echo ""

aws secretsmanager put-secret-value --region <region> \
  --secret-id keycloak/admin \
  --secret-string "$(jq -nc \
    --arg u kcadmin \
    --arg p "$NEW_PWD" \
    '{username:$u, password:$p}')"
```

## Export ad-hoc de realms

Para backup manual antes de cambios importantes:

```bash
aws ssm send-command --instance-ids <id> --region <region> \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["docker exec keycloak-keycloak-1 /opt/keycloak/bin/kc.sh export --dir /opt/keycloak/data/export --realm app-prod","docker exec keycloak-keycloak-1 /opt/keycloak/bin/kc.sh export --dir /opt/keycloak/data/export --realm app-staging","ls -la /opt/keycloak/data/export/"]'
```

El export queda en el EBS data, cubierto por DLM. Para descargar a tu máquina:

```bash
aws ssm start-session --target <id> --region <region>
# dentro del host:
sudo cat /opt/keycloak/data/export/app-prod-realm.json | base64
# copiar y decodificar en tu máquina
```

## Verificación DLM snapshots

```bash
# Listar policies activas
aws dlm get-lifecycle-policies --region <region> \
  --query 'Policies[].[PolicyId,State,Description]' --output table

# Listar snapshots reales del volumen Keycloak
KC_VOL=$(aws ec2 describe-volumes --region <region> \
  --filters Name=tag:Name,Values=keycloak-data \
  --query 'Volumes[0].VolumeId' --output text)

aws ec2 describe-snapshots --region <region> \
  --filters Name=volume-id,Values=$KC_VOL \
            Name=tag:SnapshotCreatedBy,Values=DLM \
  --query 'Snapshots[].[SnapshotId,StartTime,State]' --output table
```

Primer snapshot automático tarda hasta 24h desde apply. Si necesitas uno
inmediato:

```bash
aws ec2 create-snapshot --region <region> --volume-id $KC_VOL \
  --description "manual smoke" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Backup,Value=true},{Key=Reason,Value=manual}]'
```

## Restore tras corrupción H2

Si el fichero H2 se corrompe (crash + power loss raro, o EBS attachment perdido):

1. Stop del stack en la EC2:
   ```bash
   aws ssm send-command --instance-ids <id> --region <region> \
     --document-name AWS-RunShellScript \
     --parameters 'commands=["systemctl stop keycloak-stack.service"]'
   ```
2. Detach del EBS data corrupto y attach del último snapshot DLM como nuevo volumen.
3. Si el directorio `/opt/keycloak/data/h2/` quedó dañado solo, restaurar desde snapshot manualmente y volver a montar.
4. Start del stack:
   ```bash
   aws ssm send-command --instance-ids <id> --region <region> \
     --document-name AWS-RunShellScript \
     --parameters 'commands=["systemctl start keycloak-stack.service"]'
   ```
5. Si nada de lo anterior funciona, último recurso: destruir el EC2 (no el EBS por `prevent_destroy = true`), recrear con `terraform apply`, attach del volumen original o snapshot.

Pérdida aceptada: cambios entre snapshots (máximo 24h con la policy actual).

## Troubleshooting

### El endpoint devuelve 200 pero el client_credentials da 500

Revisar el log del container buscando `Failed to decode URL`:

```bash
aws ssm send-command --instance-ids <id> --region <region> \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["docker logs --tail 100 keycloak-keycloak-1 2>&1 | grep -iE \"error|exception\""]'
```

Si aparece `Failed to decode URL` con un fragmento del client_secret, el secret
contiene una secuencia ilegal de URL-encoding (típicamente `%` no seguido de 2
hex chars). Regenerar el secret desde la UI de KC (URL-safe por defecto) y
sincronizar a Secrets Manager.

### Container en restart loop

```bash
aws ssm send-command --instance-ids <id> --region <region> \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["docker ps -a","docker logs --tail 50 keycloak-keycloak-1"]'
```

Causas comunes:

- Flag no válida en el `command` del compose (KC 26 deprecated varias flags).
- Volume mount mal con permisos UID 1000 (KC corre como usuario 1000).
- H2 file lockeado por proceso huérfano. Reiniciar Docker: `systemctl restart docker`.

### `curl` recibe 403 con `cf-mitigated: challenge`

Super Bot Fight Mode bloquea el cliente. Opciones por orden de preferencia:

- Crear **WAF Custom Rule por hostname** (Reglas personalizadas, NO Reglas administradas) con acción `Skip` marcando `Super Bot Fight Mode`. Aplica de forma quirúrgica solo a `kc.*`.
- Desactivar `Detecciones de JavaScript` en CF Bots config (necesario también para flujos backchannel server-to-server donde el cliente no ejecuta JS).
- Añadir header `-A "Mozilla/5.0"` (workaround puntual para curl manual).

Nota: las **excepciones a Reglas administradas NO omiten SBFM**. Solo desde
una Custom Rule se puede saltar SBFM explícitamente.

### API consumidora recibe HTML CF en vez de JSON al pedir token

Síntoma típico en backend que llama a `/realms/<realm>/protocol/openid-connect/token`:

```
Failed to get admin token: <!DOCTYPE html><html ...><title>Just a moment...</title>
```

Causa: SBFM con JavaScript challenge intercepta la request. El backend no puede
ejecutar JS para resolver el challenge.

Fix permanente:

1. WAF Custom Rule skip SBFM para hosts del realm KC.
2. Bots → `Detecciones de JavaScript = OFF`.
3. (Opcional) `Definitivamente automatizado = Permitir` para toda la zona, aunque la Custom Rule es preferible.

### Login devuelve 401 `Invalid token: missing subject`

Causa: el cliente Keycloak (`app-api`) no tiene el scope `basic` asignado como
Default, así que el access token emitido por el password grant no incluye el
claim `sub`. La API rechaza el token al no encontrar el subject.

Fix:

1. KC admin UI → realm correspondiente → `Clients` → `app-api`.
2. Tab `Client scopes`.
3. `Add client scope` → marcar `basic` → `Add` con tipo `Default`.

Repetir por cada realm afectado (`app-staging`, `app-prod`).

Tras añadirlo, el siguiente login emite tokens con `sub` (UUID del usuario en
KC). No requiere reiniciar el servidor KC.

### `curl` recibe 525 SSL handshake fail

CF está en modo `Full` o `Full (strict)` para el hostname y el origen solo
acepta HTTP. Verificar que la Page Rule SSL=Flexible cubre el patrón
`kc*.<domain>/*`.

### Login admin devuelve `user_not_found`

Confirmar que el username es `kcadmin` (no el password). El log muestra el
intento con el campo `username` mal rellenado.

## Coste mensual estimado

| Componente | €/mes IVA |
|---|---|
| EC2 t4g.small ARM 24/7 | ~12 |
| EBS gp3 30 GB encrypted | ~2 |
| Secrets Manager (3 entries) | ~1.5 |
| CloudWatch Logs (bajo volumen) | ~0.3 |
| DLM snapshots (delta diario 7 rolling) | ~1-2 |
| **Total phase-kc** | **~17** |
