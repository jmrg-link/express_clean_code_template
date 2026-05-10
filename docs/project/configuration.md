# Configuración

Sistema de configuración: validación runtime con Zod por subsistema,
fail-fast con `parseOrDie`, agrupado por dominio y congelado con
`Object.freeze`. Diferencia explícita entre **API vars** (consumidas
por `src/config/env.ts`) y **stack vars** (compose / Traefik /
Keycloak admin).

---

## Indice

1. [Patron de configuracion](#patron-de-configuracion)
2. [Variables API](#variables-api)
3. [Variables stack (compose / Traefik / KC)](#variables-stack-compose--traefik--kc)
4. [Flags derivadas](#flags-derivadas)
5. [Perfiles `.env`](#perfiles-env)
6. [Generacion de secrets](#generacion-de-secrets)
7. [Validacion fail-fast](#validacion-fail-fast)

---

## Patron de configuracion

`src/config/env.ts` (137 LOC) es el unico punto de entrada de
configuracion. Diseño:

1. `import 'dotenv/config'` — carga el `.env` activo en `process.env`.
2. **Un Zod schema por subsistema** (server, mongo, keycloak, jwt, s3,
   loki).
3. Helper `emptyToUndefined` (`env.ts:24-26`) convierte `KEY=` (string
   vacio) en `undefined`. Sin esto, Zod ve `""` como string presente y
   falla en `.url()` o `.min(16)`.
4. `parseOrDie(schema, label)` (`env.ts:80-87`) ejecuta `safeParse`; si
   falla, imprime `flatten().fieldErrors` y `process.exit(1)`.
5. Resultados agrupados por dominio en `export const env = Object.freeze({...})`
   (`env.ts:96-135`).

**Beneficios**:
- Fail-fast: caer en `npm start` es mejor que NPE en produccion a los
  5 minutos.
- Acceso tipado: `env.server.port`, `env.mongo.uri`, `env.s3.isConfigured`.
- Inmutable post-arranque (`Object.freeze`).
- Agrupacion por dominio reduce ruido SCREAMING_SNAKE en consumers.

```ts
// src/config/env.ts:80-87
function parseOrDie<T extends z.ZodTypeAny>(schema: T, label: string): z.infer<T> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error(`❌ Invalid env (${label}):`, parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data as z.infer<T>;
}
```

---

## Variables API

> Todas derivadas de `src/config/env.ts:28-94`. Sin valores reales —
> placeholders descriptivos en ejemplos.

### Server

`ServerSchema` (`src/config/env.ts:28-38`):

| Variable | Tipo Zod | Default | Requerido | Proposito | Ejemplo |
|---|---|---|---|---|---|
| `PORT` | `coerce.number().int().positive()` | `3000` | no | Puerto HTTP del servidor Express. | `3000` |
| `HOST` | `string` | `0.0.0.0` | no | Bind host. `0.0.0.0` para container. | `0.0.0.0` |
| `NODE_ENV` | enum (`local`/`development`/`staging`/`production`/`test`) | `local` | no | Cambia logging strategy y CORS. | `production` |
| `API_PREFIX` | `string startsWith('/')` | `/api` | no | Prefijo URL antes de version. | `/api` |
| `API_VERSION` | `string` | `v1` | no | Sufijo URL (resultado: `/api/v1/...`). | `v1` |
| `CORS_ORIGINS` | csv string | `''` (= `false` whitelist) | recomendado prod | Lista origenes coma-separados. Vacio → CORS bloquea cross-origin. | `https://app.example.com,https://admin.example.com` |

### Mongo

`MongoSchema` (`src/config/env.ts:40-42`):

| Variable | Tipo Zod | Default | Requerido | Proposito | Ejemplo |
|---|---|---|---|---|---|
| `MONGODB_URI` | `string().url()` | — | **si** | URI Mongo completa (incluye db, user, pwd, replica set si aplica). | `mongodb://<USER>:<PASSWORD>@<HOST>:27017/<DB>?authSource=admin` |

### Keycloak

`KeycloakSchema` (`src/config/env.ts:44-49`):

| Variable | Tipo Zod | Default | Requerido | Proposito | Ejemplo |
|---|---|---|---|---|---|
| `KEYCLOAK_URL` | `string().url()` | — | **si** | Base URL Keycloak (sin trailing slash). | `https://auth.example.com` |
| `KEYCLOAK_REALM` | `string().min(1)` | — | **si** | Realm name. | `<REALM_NAME>` |
| `KEYCLOAK_CLIENT_ID` | `string().min(1)` | — | **si** | Client id confidential. | `app-api` |
| `KEYCLOAK_CLIENT_SECRET` | `string` opcional (via `emptyToUndefined`) | — | si confidential | Secret del client. Public clients pueden omitirlo. | `<KC_API_SECRET>` |

### JWT (fallback dev/test)

`JwtSchema` (`src/config/env.ts:51-56`):

| Variable | Tipo Zod | Default | Requerido | Proposito | Ejemplo |
|---|---|---|---|---|---|
| `JWT_SECRET` | `string().min(16)` opcional | — | solo dev/test | Fallback HS256 si Keycloak no esta corriendo (tests). **NO usar en produccion** — produccion siempre usa Keycloak RS256. | `<32_chars_random>` |

> [!NOTE] `emptyToUndefined`
> `emptyToUndefined` se aplica a `JWT_SECRET` (`env.ts:53-55`): un
> `JWT_SECRET=` vacio se convierte a `undefined` (no string vacio que
> rompa `.min(16)`).

### S3 / LocalStack

`S3Schema` (`src/config/env.ts:58-70`):

| Variable | Tipo Zod | Default | Requerido | Proposito | Ejemplo |
|---|---|---|---|---|---|
| `AWS_REGION` | `string` | `eu-west-1` | no | Region SDK. | `eu-west-1` |
| `AWS_S3_BUCKET` | `string` opcional | — | si feature storage | Nombre bucket. Storage router se monta solo si bucket+key+secret presentes. | `<BUCKET_NAME>` |
| `AWS_ACCESS_KEY_ID` | `string` opcional | — | si feature storage | Credencial. LocalStack acepta dummy (`test`). | `<ACCESS_KEY_ID>` |
| `AWS_SECRET_ACCESS_KEY` | `string` opcional | — | si feature storage | Credencial. | `<SECRET_ACCESS_KEY>` |
| `AWS_S3_ENDPOINT` | `string().url()` opcional | — | LocalStack/MinIO | Override endpoint. Vacio en AWS real. | `http://localstack:4566` |
| `AWS_S3_FORCE_PATH_STYLE` | `'true'`/`'false'` → bool | `false` | LocalStack `true` | Path-style addressing necesario para LocalStack. | `true` |

### Loki

`LokiSchema` (`src/config/env.ts:72-74`):

| Variable | Tipo Zod | Default | Requerido | Proposito | Ejemplo |
|---|---|---|---|---|---|
| `LOKI_HOST` | `string().url()` opcional | — | en staging/prod | Endpoint push API Loki. Sin esto, no se monta el transport. | `https://loki.example.com` |

---

## Variables stack (compose / Traefik / KC)

> Estas estan en `.env.example` y son consumidas por `docker-compose.yml`,
> labels de Traefik o Keycloak admin — **NO** las lee `src/config/env.ts`.
> Documentadas como "stack vars" para evitar confusion.

| Variable | Consumida por | Proposito | Ejemplo |
|---|---|---|---|
| `DOMAIN` | Traefik labels, Keycloak `KC_HOSTNAME` | Hostname base. `${DOMAIN}` aparece en `api.${DOMAIN}`, `auth.${DOMAIN}`, etc. (`docker-compose.yml`). | `localhost` (dev) / `example.com` (prod) |
| `LE_CA_SERVER` | Traefik ACME (`docker-compose.yml:102`) | URL ACME Let's Encrypt. Default = produccion. | `https://acme-staging-v02.api.letsencrypt.org/directory` |
| `SSL_EMAIL` | Traefik ACME (`docker-compose.yml:100`) | Email de notificaciones LE. | `<EMAIL>` |
| `OIDC_PLUGIN_SECRET` | Plugin OIDC en Traefik (`docker-compose.yml:61,175`) | Cifra cookie de sesion del plugin. **Mandatorio** (`:?required`). | `<32_chars_random>` |
| `KC_PANELS_SECRET` | Plugin OIDC + KC client (`docker-compose.yml:62,178`) | Secret del cliente `traefik-panels`. **Mandatorio**. | `<32_chars_random>` |
| `KC_API_SECRET` | API service (`docker-compose.yml:300`) y KC client | Override del secret `app-api` commiteado en `app-realm.json`. **Mandatorio**. | `<32_chars_random>` |
| `KC_ADMIN_USER` | Keycloak bootstrap (`docker-compose.yml:235`) | Usuario admin master Keycloak. | `admin` |
| `KC_ADMIN_PASSWORD` | Keycloak bootstrap (`docker-compose.yml:236`) | Password admin master. **Mandatorio** (`:?required`). | `<random>` |
| `KEYCLOAK_INTERNAL_URL` | API container (`docker-compose.yml:297`) | URL interna red `proxy` (no via Traefik). En staging/prod cambiar a URL publica. | `http://keycloak:8080` |
| `GRAFANA_ADMIN_PASSWORD` | Grafana service (`docker-compose.yml:430`) | Password admin inicial Grafana. | `<random>` |
| `TRAEFIK_AUTH` | Middleware basicauth Traefik (`docker-compose.yml:169`) | htpasswd `user:hash` para 2FA dashboard. | `admin:<htpasswd_hash>` |

### Compartidas API + stack

| Variable | API la lee? | Compose la lee? |
|---|---|---|
| `CORS_ORIGINS` | si (`env.ts:34-37`) | si (Traefik `cors-api` middleware) |
| `NODE_ENV` | si (`env.ts:31`) | si (api service env) |
| `MONGODB_URI` | si | si (api service inyecta el valor) |
| `LOKI_HOST` | si | si (api service env) |

> [!NOTE] `TRAEFIK_AUTH` placeholder
> Default en compose: `${TRAEFIK_AUTH:-admin:$$apr1$$placeholder$$placeholder}`
> (`docker-compose.yml:169`) **no es un hash htpasswd valido**. Si se
> arranca sin override, el dashboard de Traefik queda protegido solo
> por `lan-only` + `kc-auth`.
>
> **Fix**: generar hash real con `htpasswd -nb admin <password>` y
> exportar en `.env.local`. `scripts/generate-secrets.sh` puede
> emitirlo.

> [!NOTE] Symlink `.env -> .env.local`
> Existe como conveniencia para `dotenv/config`, que lee `.env` por
> defecto. Recrear con `ln -s .env.local .env` si se pierde.

---

## Flags derivadas

`env.server` (`src/config/env.ts:104-107`) expone flags computadas:

| Flag | Valor true cuando |
|---|---|
| `env.server.isProduction` | `NODE_ENV === 'production'` |
| `env.server.isStaging` | `NODE_ENV === 'staging'` |
| `env.server.isDevelopment` | `NODE_ENV === 'development'` o `'local'` |
| `env.server.isTest` | `NODE_ENV === 'test'` |

Consumidas en:

- `winston.adapter.ts:43-58` — Loki transport solo si
  `(isProduction || isStaging) && env.loki.host`.
- `winston.adapter.ts` — formato dev (printf) vs prod (json).
- `app.ts:55` — `morgan('dev')` solo si `!env.server.isTest`.
- `env.s3.isConfigured` (`env.ts:129-130`): true si bucket + key +
  secret presentes. Si false, `StorageRouter` no se monta.

---

## Perfiles `.env`

Tres perfiles soportados via `dotenv-cli`:

| Perfil | Uso | Comando npm |
|---|---|---|
| `.env.local` | Desarrollo local (default `pnpm dev`). | `pnpm dev` / `pnpm dev:local` |
| `.env.staging` | Staging deploy. | `pnpm dev:staging` / `pnpm start:staging` |
| `.env.production` | Production deploy. | `pnpm start` / `pnpm start:prod` |

Definidos en `package.json:33-49` (referenciados por researcher-03).
Ejemplo invocacion:

```bash
dotenv -e .env.staging -- node dist/main.js
```

Con `--env-file=.env.production` de Node 20+ tambien funciona como
alternativa.

### `.env.example`

Plantilla en repo con todas las variables documentadas arriba **sin
valores reales**. Copiar a `.env.local` o usar como referencia para
crear `.env.staging` / `.env.production`.

### Validacion en `.gitignore`

`.gitignore:10-14` excluye (validado por team-lead):

- `.env.local`
- `.env.staging`
- `.env.production`
- `.env.secrets`

NO excluido: `.env.example` (template publico) y
`keycloak/app-realm.json` (secrets dev placeholders, rotables via `scripts/rotate-keycloak-secrets.sh`).

---

## Generacion de secrets

`scripts/generate-secrets.sh:38-46` — genera 7 secrets con
`openssl rand -base64`:

| Secret generado | Destino |
|---|---|
| `OIDC_PLUGIN_SECRET` | Cookie cifrado plugin OIDC |
| `KC_PANELS_SECRET` | Client `traefik-panels` |
| `KC_API_SECRET` | Client `app-api` (override realm.json dev) |
| `KC_ADMIN_PASSWORD` | Admin master Keycloak |
| `JWT_SECRET` | Fallback HS256 (dev/test) |
| `GRAFANA_ADMIN_PASSWORD` | Admin Grafana |
| `TRAEFIK_AUTH` | htpasswd basicauth dashboard |

Salida: `.env.secrets` (gitignored). Procedimiento:

```bash
./scripts/generate-secrets.sh         # genera .env.secrets
cat .env.secrets >> .env.local        # mergear en perfil activo
# Editar .env.local para añadir DOMAIN, MONGODB_URI, KEYCLOAK_URL, etc.
```

---

## Validacion fail-fast

Si una variable requerida falta o tiene formato invalido, el arranque
**aborta** con exit code 1 y mensaje formateado:

```
❌ Invalid env (mongo): { MONGODB_URI: [ 'Required' ] }
```

`flatten().fieldErrors` muestra los campos exactos con sus errores
Zod. Equivalente al ejemplo:

```ts
// src/config/env.ts:80-87
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(`❌ Invalid env (${label}):`, parsed.error.flatten().fieldErrors);
  process.exit(1);
}
```

### Errores comunes

| Mensaje | Causa | Fix |
|---|---|---|
| `MONGODB_URI: [ 'Required' ]` | Variable ausente. | Añadir a `.env.<perfil>`. |
| `MONGODB_URI: [ 'Invalid url' ]` | Formato no es URL valida. | Verificar `mongodb://...`. |
| `JWT_SECRET: [ 'String must contain at least 16 character(s)' ]` | Secret demasiado corto. | Generar con `openssl rand -base64 24`. |
| `API_PREFIX: [ 'String must start with "/"' ]` | Falta slash inicial. | `/api`. |

### Lectura desde Docker Compose

`docker-compose.yml` propaga variables al container `api`
(`docker-compose.yml:287-315`). Las que NO esten en el shell o en
`.env` (lo lee compose automaticamente) toman el default `${VAR:-default}`
o disparan error `${VAR:?required}`.

---

## Drift docs ↔ codigo

Si tocas `src/config/env.ts` (añadir/quitar vars, cambiar default,
cambiar schema), **actualiza este capitulo**. Check sugerido para PR
en cap 12 (onboarding).

---

## Referencias cruzadas

- Cap 05 (Infraestructura): adapters consumen `env.*`.
- Cap 06 (Plataforma): compose enforce `${VAR:?required}` para vars
  criticas.
- Cap 07 (Seguridad): `JWT_SECRET` solo dev/test, `CORS_ORIGINS`
  whitelist, secrets management.
- Cap 09 (Observabilidad): `LOKI_HOST` activacion transport.
