import slugifyModule from 'slugify';
const slugify = slugifyModule as unknown as (input: string, opts?: {
  lower?: boolean;
  strict?: boolean;
  locale?: string;
  trim?: boolean;
  replacement?: string;
}) => string;

/**
 * Helper para generar slugs URL-friendly.
 *
 * Estrategia:
 *   - `slugify` con lower:true, strict:true (elimina puntuación), y locale 'es'
 *     para mapear ñ→n y caracteres acentuados a sus equivalentes ASCII.
 *   - Si el resultado es vacío (input solo símbolos/CJK), usamos un fallback
 *     estable derivado del input.
 *   - `withRandomSuffix` añade 6 chars aleatorios para evitar colisiones
 *     (mejor que pre-check + retry, que sufre de race condition).
 */
export const Slugger = {
  base(input: string): string {
    const out = slugify(input, {
      lower: true,
      strict: true,
      locale: 'es',
      trim: true,
    });
    if (out) return out.slice(0, 80);
    const ascii = Buffer.from(input).toString('hex').slice(0, 12);
    return `user-${ascii}`;
  },

  withRandomSuffix(input: string): string {
    const base = Slugger.base(input);
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${base}-${suffix}`;
  },
};
