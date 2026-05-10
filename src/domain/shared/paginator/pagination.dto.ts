import { z } from 'zod';

/**
 * DTO global para queries paginadas.
 * Acepta strings (vienen de querystring) y los coerciona a número.
 */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Forma del meta de paginación. Cuimo-style:
 *  - count y totalPages son números.
 *  - nextPage y previousPage son booleanos (más cómodo en frontend).
 *  - además incluimos next/prev como número|null para infinite scroll.
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  count: number;
  totalPages: number;
  nextPage: boolean;
  previousPage: boolean;
  next: number | null;
  prev: number | null;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}
