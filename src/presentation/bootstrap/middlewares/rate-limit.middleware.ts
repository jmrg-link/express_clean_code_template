import rateLimit from 'express-rate-limit';

/**
 * Permite saltarse los límites en suites `vitest` (NODE_ENV=test) sin que el
 * contador in-memory acumule peticiones entre casos de un mismo describe.
 */
const isTestEnv = process.env.NODE_ENV === 'test';

/**
 * Rate limiter agresivo para `/auth/login`.
 *
 * @remarks
 * Ventana 60 s, 5 intentos por IP. `skipSuccessfulRequests` evita penalizar
 * al usuario legítimo que falla una vez y luego acierta. En despliegues con
 * varias réplicas detrás de un balanceador, sustituir el store en memoria
 * por un `RedisStore` compartido para que el contador sea consistente.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTestEnv ? 9999 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: 'Too many login attempts, please try again later' },
});

/**
 * Rate limiter para `/auth/register` (anti-mass-registration).
 *
 * @remarks
 * Ventana 60 s, 3 intentos por IP. A diferencia de `loginRateLimiter`, NO
 * salta los exitosos: un atacante no debe poder registrar muchas cuentas
 * válidas en serie aunque cada intento sea correcto. Mantener un store
 * distribuido en producción multi-réplica.
 */
export const registerRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTestEnv ? 9999 : 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many registration attempts, please try again later' },
});

/**
 * Rate limiter global (defensa en profundidad).
 *
 * @remarks
 * Ventana 15 min, 300 peticiones por IP. Aplica a toda la API; los limiters
 * más estrictos (login/register) se componen sobre éste.
 */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
