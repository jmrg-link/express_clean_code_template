import { describe, it, expect } from 'vitest';
import { matchesAdminPattern } from '#domain/auth/admin-email-policy';

/**
 * Test fixtures usan exclusivamente dominios reservados RFC 2606
 * (`example.com`, `example.org`, `example.net`). Cero referencias a dominios
 * reales del operador — esos viven solo en archivos `.env.*` locales.
 */

describe('matchesAdminPattern', () => {
  describe('empty / unset policy', () => {
    it('returns false when patterns array is empty', () => {
      expect(matchesAdminPattern('user@example.com', [])).toBe(false);
    });
  });

  describe('wildcard-domain pattern', () => {
    const patterns = ['*@example.com', '*@example.org'];

    it('matches any local-part on configured domain', () => {
      expect(matchesAdminPattern('alice@example.com', patterns)).toBe(true);
      expect(matchesAdminPattern('bob@example.org', patterns)).toBe(true);
    });

    it('does not match other domains', () => {
      expect(matchesAdminPattern('attacker@example.net', patterns)).toBe(false);
    });

    it('is case-insensitive on local-part and domain', () => {
      expect(matchesAdminPattern('Alice@EXAMPLE.COM', patterns)).toBe(true);
      expect(matchesAdminPattern('BOB@example.ORG', patterns)).toBe(true);
    });

    it('trims whitespace before matching', () => {
      expect(matchesAdminPattern('  alice@example.com  ', patterns)).toBe(true);
    });

    it('rejects look-alike subdomain (no glob across dots)', () => {
      expect(matchesAdminPattern('user@evil.example.com', patterns)).toBe(false);
      expect(matchesAdminPattern('user@example.com.evil.net', patterns)).toBe(false);
    });
  });

  describe('literal email pattern', () => {
    const patterns = ['cto@example.org'];

    it('matches only the exact literal email', () => {
      expect(matchesAdminPattern('cto@example.org', patterns)).toBe(true);
      expect(matchesAdminPattern('CTO@EXAMPLE.ORG', patterns)).toBe(true);
    });

    it('does not match different local-part on the same domain', () => {
      expect(matchesAdminPattern('intern@example.org', patterns)).toBe(false);
    });
  });

  describe('mixed literal + wildcard list', () => {
    const patterns = ['cto@example.org', '*@example.com'];

    it('matches when any pattern in the list applies', () => {
      expect(matchesAdminPattern('cto@example.org', patterns)).toBe(true);
      expect(matchesAdminPattern('anything@example.com', patterns)).toBe(true);
    });

    it('rejects emails outside both rules', () => {
      expect(matchesAdminPattern('other@example.net', patterns)).toBe(false);
    });
  });

  describe('malformed inputs', () => {
    const patterns = ['*@example.com'];

    it('returns false for empty string', () => {
      expect(matchesAdminPattern('', patterns)).toBe(false);
    });

    it('returns false for input without `@`', () => {
      expect(matchesAdminPattern('not-an-email', patterns)).toBe(false);
    });

    it('returns false for input starting with `@`', () => {
      expect(matchesAdminPattern('@example.com', patterns)).toBe(false);
    });

    it('returns false for input ending with `@`', () => {
      expect(matchesAdminPattern('user@', patterns)).toBe(false);
    });
  });
});
