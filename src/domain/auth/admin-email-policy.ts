/**
 * Política pura de detección de emails con privilegio admin.
 *
 * @remarks
 * Sin IO, sin estado. Las reglas se inyectan desde `env.auth.adminEmailPatterns`.
 * Soporta dos formas de patrón, validadas previamente por Zod en `config/env.ts`:
 *
 *  - Literal `<localpart>@<domain.tld>` → coincide solo con ese email exacto
 *    (case-insensitive).
 *  - Wildcard de dominio `*@<domain.tld>` → coincide con cualquier email cuyo
 *    dominio sea exactamente el indicado.
 *
 * No se soportan otras glob expressions (`prefix*@`, `*@*.tld`, regex) — la
 * validación de patrón vive en Zod y rechaza variantes al arrancar.
 *
 * Si la lista de patrones está vacía, la política queda apagada y la función
 * devuelve `false` para cualquier email (default seguro).
 */
export type AdminEmailPattern = string;

/**
 * Decide si un email cumple con alguno de los patrones admin configurados.
 *
 * @param email - Email a evaluar. Se aplica `trim()` + `toLowerCase()` antes
 *   de comparar para neutralizar inputs ruidosos.
 * @param patterns - Lista validada por Zod, en lowercase, sin espacios.
 * @returns `true` si algún patrón coincide; `false` en otro caso.
 */
export function matchesAdminPattern(
  email: string,
  patterns: ReadonlyArray<AdminEmailPattern>,
): boolean {
  if (patterns.length === 0) return false;

  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  const atIdx = normalized.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === normalized.length - 1) return false;
  const domain = normalized.slice(atIdx + 1);

  for (const pattern of patterns) {
    if (pattern.startsWith('*@')) {
      if (domain === pattern.slice(2)) return true;
    } else if (pattern === normalized) {
      return true;
    }
  }
  return false;
}
