import type { PaginationMeta, PaginationQuery, PaginatedResult } from './pagination.dto.js';

export class Paginator {
  /** skip para el driver de BBDD. */
  public static skip(query: PaginationQuery): number {
    return (query.page - 1) * query.limit;
  }

  /** Construye el resultado con `data + pagination`. */
  public static build<T>(items: T[], total: number, query: PaginationQuery): PaginatedResult<T> {
    const { page, limit } = query;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const meta: PaginationMeta = {
      page,
      limit,
      count: total,
      totalPages,
      nextPage: page < totalPages,
      previousPage: page > 1,
      next: page < totalPages ? page + 1 : null,
      prev: page > 1 ? page - 1 : null,
    };
    return { data: items, pagination: meta };
  }
}
