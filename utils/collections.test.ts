import { describe, expect, it } from 'vitest';
import { lookup } from './collections';

describe('lookup', () => {
  it.each([0, false, ''])('preserves a valid falsy value: %s', (value) => {
    expect(lookup({ value }, 'value', 'fallback')).toBe(value);
  });

  it.each(['missing', undefined, 'toString', 'constructor', '__proto__'])(
    'falls back for missing or inherited keys: %s',
    (key) => expect(lookup({ known: 'value' }, key, 'fallback')).toBe('fallback'),
  );

  it('accepts explicit own keys, including an empty key and prototype-like names', () => {
    expect(lookup({ '': 'empty key', toString: 'own value' }, '', 'fallback')).toBe('empty key');
    expect(lookup({ toString: 'own value' }, 'toString', 'fallback')).toBe('own value');
  });

  it('falls back for nullish entries without changing the map', () => {
    const map = Object.freeze({ empty: null, missing: undefined, known: { label: 'Known' } });
    const fallback = { label: 'Unknown' };
    expect(lookup(map, 'empty', fallback)).toBe(fallback);
    expect(lookup(map, 'missing', fallback)).toBe(fallback);
    expect(lookup(map, 'known', fallback)).toBe(map.known);
  });
});
