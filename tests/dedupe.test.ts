import { describe, it, expect } from 'vitest';
import { DedupeStore } from '../src/core/dedupe.js';

describe('DedupeStore', () => {
  it('claims first time, rejects duplicate within TTL', () => {
    const d = new DedupeStore(10_000);
    const t0 = 1_000_000;
    expect(d.tryClaim('e1', t0)).toBe(true);
    expect(d.tryClaim('e1', t0 + 100)).toBe(false);
    expect(d.tryClaim('e2', t0)).toBe(true);
  });

  it('allows reclaim after TTL', () => {
    const d = new DedupeStore(1000);
    const t0 = 1_000_000;
    expect(d.tryClaim('e1', t0)).toBe(true);
    expect(d.tryClaim('e1', t0 + 999)).toBe(false);
    expect(d.tryClaim('e1', t0 + 1000)).toBe(true);
  });

  it('has() reflects TTL', () => {
    const d = new DedupeStore(500);
    const t0 = 5_000;
    d.tryClaim('x', t0);
    expect(d.has('x', t0 + 100)).toBe(true);
    expect(d.has('x', t0 + 500)).toBe(false);
  });

  it('clear resets', () => {
    const d = new DedupeStore();
    d.tryClaim('a');
    d.clear();
    expect(d.size()).toBe(0);
    expect(d.tryClaim('a')).toBe(true);
  });
});
