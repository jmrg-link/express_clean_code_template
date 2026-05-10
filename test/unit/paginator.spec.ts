import { describe, it, expect } from 'vitest';
import { Paginator } from '#domain/shared/paginator/paginator';

describe('Paginator', () => {
  it('computes skip correctly', () => {
    expect(Paginator.skip({ page: 1, limit: 20, order: 'desc' })).toBe(0);
    expect(Paginator.skip({ page: 3, limit: 10, order: 'desc' })).toBe(20);
  });

  it('builds meta with hasNext/hasPrev', () => {
    const result = Paginator.build([1, 2, 3], 25, { page: 2, limit: 10, order: 'desc' });
    expect(result.pagination).toMatchObject({
      page: 2,
      limit: 10,
      count: 25,
      totalPages: 3,
      nextPage: true,
      previousPage: true,
      next: 3,
      prev: 1,
    });
  });

  it('handles last page (no next)', () => {
    const result = Paginator.build([1], 21, { page: 3, limit: 10, order: 'desc' });
    expect(result.pagination.nextPage).toBe(false);
    expect(result.pagination.next).toBeNull();
  });

  it('handles empty result (totalPages >= 1)', () => {
    const result = Paginator.build([], 0, { page: 1, limit: 10, order: 'desc' });
    expect(result.pagination.totalPages).toBe(1);
    expect(result.pagination.nextPage).toBe(false);
    expect(result.pagination.previousPage).toBe(false);
  });
});
