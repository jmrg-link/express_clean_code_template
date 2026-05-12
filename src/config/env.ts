import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({
  path: `.env.${process.env.NODE_ENV ?? 'local'}`,
  override: true,
});

/**
 * Validación runtime de envs, agrupada por subsistema.
 *
 * Diseño:
 *   - Cada subsistema tiene su grupo (`server`, `mongo`, `keycloak`, etc.).
 *   - El consumer accede como `env.server.port`, `env.mongo.uri`, etc.
 *   - Esto reduce el ruido de "env.SCREAMING_SNAKE" en el resto del código y
 *     hace explícito a qué dominio pertenece cada valor.
 *   - La fuente sigue siendo `process.env` con SCREAMING_SNAKE (estándar).
 *
 * Fail-fast: si alguno falla, no arrancamos. Mejor caer en `npm start` que
 * petar con NPE en producción a los 5 minutos.
 */

/**
 * Helper Zod: convierte el string vacío `""` (común cuando el `.env` tiene
 * `KEY=` sin valor) en `undefined`. Sin esto, Zod ve "" como string presente
 * y falla en `.url()` o `.min(16)`. Lo aplicamos a todos los opcionales que
 * viajan por dotenv.
 */
const emptyToUndefined = z
  .string()
  .transform((v) => (v.trim() === '' ? undefined : v));

const ServerSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['local', 'development', 'staging', 'production', 'test']).default('local'),
  API_PREFIX: z.string().startsWith('/').default('/api'),
  API_VERSION: z.string().default('v1'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
});

const MongoSchema = z.object({
  MONGODB_URI: z.string().url(),
});

const KeycloakSchema = z.object({
  KEYCLOAK_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().min(1),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_CLIENT_SECRET: emptyToUndefined.optional(),
  KEYCLOAK_PUBLIC_ISSUER: emptyToUndefined.optional(),
});

const JwtSchema = z.object({
  /** Fallback HS256 solo dev/test. Producción debería usar SIEMPRE Keycloak (RS256). */
  JWT_SECRET: emptyToUndefined
    .optional()
    .pipe(z.string().min(16).optional()),
});

const RbacSchema = z.object({
  /**
   * Si `true`, en el arranque la app ejecuta el `BootstrapRoleReconciler`:
   * promueve a `admin` los usuarios de Mongo cuyo email cumpla
   * `ADMIN_EMAIL_PATTERNS`. Idempotente — seguro dejarlo `true` permanente.
   */
  RBAC_BOOTSTRAP_RECONCILE: z
    .string()
    .default('false')
    .transform((v) => v.trim().toLowerCase() === 'true'),
});

const AuthSchema = z.object({
  /**
   * CSV de patrones admin leídos desde `process.env.ADMIN_EMAIL_PATTERNS`.
   * Acepta literal `<localpart>@<domain.tld>` o wildcard de dominio
   * `*@<domain.tld>`. Lista vacía → política off. Ningún valor por defecto
   * con dominios reales en código; el operador configura el env file.
   */
  ADMIN_EMAIL_PATTERNS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(
      z.array(
        z
          .string()
          .regex(
            /^(\*@|[^\s@*]+@)[^\s@*]+\.[^\s@*]+$/,
            'invalid pattern (use info@domain.tld or *@domain.tld)',
          ),
      ),
    ),
});

const S3Schema = z.object({
  AWS_REGION: z.string().default('eu-west-1'),
  AWS_S3_BUCKET: emptyToUndefined.optional(),
  AWS_ACCESS_KEY_ID: emptyToUndefined.optional(),
  AWS_SECRET_ACCESS_KEY: emptyToUndefined.optional(),
  /** Endpoint custom (LocalStack, MinIO). En AWS real, dejar vacío. */
  AWS_S3_ENDPOINT: emptyToUndefined.optional().pipe(z.string().url().optional()),
  /** Path-style addressing — necesario para LocalStack/MinIO. */
  AWS_S3_FORCE_PATH_STYLE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

const LokiSchema = z.object({
  LOKI_HOST: emptyToUndefined.optional().pipe(z.string().url().optional()),
});

/* ------------------------------------------------------------------
 * Parse + agrupado
 * ------------------------------------------------------------------ */

function parseOrDie<T extends z.ZodTypeAny>(schema: T, label: string): z.infer<T> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error(`❌ Invalid env (${label}):`, parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data as z.infer<T>;
}

const server = parseOrDie(ServerSchema, 'server');
const mongo = parseOrDie(MongoSchema, 'mongo');
const keycloak = parseOrDie(KeycloakSchema, 'keycloak');
const jwt = parseOrDie(JwtSchema, 'jwt');
const rbac = parseOrDie(RbacSchema, 'rbac');
const auth = parseOrDie(AuthSchema, 'auth');
const s3 = parseOrDie(S3Schema, 's3');
const loki = parseOrDie(LokiSchema, 'loki');

export const env = Object.freeze({
  server: {
    port: server.PORT,
    host: server.HOST,
    nodeEnv: server.NODE_ENV,
    apiPrefix: server.API_PREFIX,
    apiVersion: server.API_VERSION,
    corsOrigins: server.CORS_ORIGINS,
    isProduction: server.NODE_ENV === 'production',
    isStaging: server.NODE_ENV === 'staging',
    isDevelopment: server.NODE_ENV === 'development' || server.NODE_ENV === 'local',
    isTest: server.NODE_ENV === 'test',
  },
  mongo: {
    uri: mongo.MONGODB_URI,
  },
  keycloak: {
    url: keycloak.KEYCLOAK_URL,
    realm: keycloak.KEYCLOAK_REALM,
    clientId: keycloak.KEYCLOAK_CLIENT_ID,
    clientSecret: keycloak.KEYCLOAK_CLIENT_SECRET,
    publicIssuer: keycloak.KEYCLOAK_PUBLIC_ISSUER,
  },
  jwt: {
    secret: jwt.JWT_SECRET,
  },
  auth: {
    /** Patrones que conceden rol admin al registrar/sincronizar usuarios. */
    adminEmailPatterns: Object.freeze(auth.ADMIN_EMAIL_PATTERNS) as ReadonlyArray<string>,
  },
  rbac: {
    /** Activa el reconciler en boot (promueve admins existentes). */
    bootstrapReconcile: rbac.RBAC_BOOTSTRAP_RECONCILE,
  },
  s3: {
    region: s3.AWS_REGION,
    bucket: s3.AWS_S3_BUCKET,
    accessKeyId: s3.AWS_ACCESS_KEY_ID,
    secretAccessKey: s3.AWS_SECRET_ACCESS_KEY,
    endpoint: s3.AWS_S3_ENDPOINT,
    forcePathStyle: s3.AWS_S3_FORCE_PATH_STYLE,
    /**
     * El adapter se inicializa con bucket. Las credenciales son opcionales:
     * si no hay `AWS_ACCESS_KEY_ID/SECRET`, el SDK aplica el default provider
     * chain (env vars exportadas, profile vía `AWS_PROFILE`, EC2 instance
     * role). Esto permite local con profile, EC2 con instance role y
     * LocalStack con keys literales sin tocar código.
     */
    isConfigured: Boolean(s3.AWS_S3_BUCKET),
  },
  loki: {
    host: loki.LOKI_HOST,
  },
});

export type Env = typeof env;
