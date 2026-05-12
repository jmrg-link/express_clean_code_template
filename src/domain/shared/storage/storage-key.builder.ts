import { randomBytes } from 'node:crypto';
import { Slugger } from '#domain/shared/slug/slugger';
import { CustomError } from '#domain/shared/errors';
import { StorageCategorySchema, type StorageCategory } from './storage-categories.js';

/**
 * Input para `StorageKeyBuilder.build`. `userSlug` viene del campo `slug` del
 * `User`, ya slugificado al registrarse (invariante mantenida server-side).
 * El builder NO re-slugifica `userSlug`: hay una única fuente de verdad para
 * el slug del usuario.
 */
export interface StorageKeyBuilderInput {
  userSlug: string;
  category: StorageCategory;
  originalFilename: string;
}

/**
 * Extrae la extensión final en minúsculas, sin el punto. Considera solo la
 * última `.` del nombre. Dotfiles (`.env`, `.gitignore`) devuelven cadena
 * vacía porque el nombre no tiene parte previa a la última `.`.
 *
 * @param filename - Nombre completo del archivo tal como llega del cliente.
 * @returns Extensión sin punto, en minúsculas; o `''` si no hay extensión.
 */
export function extractExt(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return '';
  return filename.slice(lastDot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Devuelve un sufijo aleatorio de 6 caracteres `[a-z0-9]` derivado de
 * `crypto.randomBytes`. Se usa para evitar colisiones en keys cuando dos
 * uploads del mismo usuario llegan con el mismo filename.
 *
 * Reintenta hasta 4 veces si el filtrado regex deja la cadena corta;
 * estadísticamente nunca ocurre. Más allá lanza `CustomError.internal`
 * para no devolver una key truncada.
 */
export function randomSuffix6(): string {
  for (let i = 0; i < 4; i++) {
    const candidate = randomBytes(8)
      .toString('base64url')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
    if (candidate.length >= 6) return candidate.slice(0, 6);
  }
  throw CustomError.internal('Unable to generate random suffix after 4 attempts');
}

/**
 * Constructor determinista de keys S3 con la forma:
 *
 *   `users/{userSlug}/{category}/{file-slug}-{rand6}{.ext?}`
 *
 * - `userSlug`: tal cual viene del `User` (ya slugificado).
 * - `category`: enum cerrado validado por Zod (`StorageCategorySchema`).
 * - `file-slug`: slugificado del nombre sin extensión con `Slugger.base`.
 * - `rand6`: 6 chars `[a-z0-9]` de `crypto.randomBytes` (CSPRNG).
 * - `.ext`: extensión original en minúsculas, sin punto si vacía.
 *
 * Garantiza ASCII estricto en toda la key — sin espacios (`%20`), sin
 * acentos, sin caracteres de control.
 */
export const StorageKeyBuilder = {
  build(input: StorageKeyBuilderInput): string {
    const category = StorageCategorySchema.parse(input.category);
    const lastDot = input.originalFilename.lastIndexOf('.');
    const nameNoExt = lastDot > 0 ? input.originalFilename.slice(0, lastDot) : input.originalFilename;
    const fileSlug = Slugger.base(nameNoExt);
    const ext = extractExt(input.originalFilename);
    const suffix = randomSuffix6();
    const extPart = ext ? `.${ext}` : '';
    return `users/${input.userSlug}/${category}/${fileSlug}-${suffix}${extPart}`;
  },
};
