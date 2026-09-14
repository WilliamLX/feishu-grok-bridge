import { describe, it, expect } from 'vitest';
import { MemorySessionStore } from '../src/core/session.js';

describe('MemorySessionStore hygiene', () => {
  it('evicts idle sessions', () => {
    const store = new MemorySessionStore({
      maxHistory: 5,
      idleTtlMs: 1000,
      maxSessions: 100,
    });
    const s = store.get('oc_a');
    // Force stale updatedAt
    s.updatedAt = Date.now() - 5000;
    expect(store.evict()).toBe(1);
    expect(store.size()).toBe(0);
  });

  it('enforces maxSessions by dropping oldest', () => {
    const now = Date.now();
    const store = new MemorySessionStore({
      maxHistory: 5,
      idleTtlMs: 60_000,
      maxSessions: 2,
    });
    const a = store.get('oc_1');
    a.updatedAt = now - 3000;
    const b = store.get('oc_2');
    b.updatedAt = now - 2000;
    store.get('oc_3'); // should evict oc_1 (oldest), keep oc_2 + oc_3
    expect(store.size()).toBe(2);
    const ids = store.list().map((s) => s.chatId).sort();
    expect(ids).toEqual(['oc_2', 'oc_3']);
  });
});
