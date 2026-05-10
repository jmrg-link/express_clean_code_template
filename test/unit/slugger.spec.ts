import { describe, it, expect } from 'vitest';
import { Slugger } from '#domain/shared/slug/slugger';

describe('Slugger', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(Slugger.base('Hello World')).toBe('hello-world');
  });

  it('strips punctuation and accents', () => {
    expect(Slugger.base('Café Olé! ¿Qué tal?')).toBe('cafe-ole-que-tal');
  });

  it('truncates to 80 chars', () => {
    const long = 'a'.repeat(120);
    expect(Slugger.base(long).length).toBeLessThanOrEqual(80);
  });

  it('falls back to user-<hex> for non-ascii-only inputs', () => {
    const out = Slugger.base('你好');
    expect(out).toMatch(/^user-/);
  });

  it('withRandomSuffix adds a 6-char suffix', () => {
    const a = Slugger.withRandomSuffix('Jane Doe');
    const b = Slugger.withRandomSuffix('Jane Doe');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^jane-doe-[a-z0-9]{1,6}$/);
  });
});
