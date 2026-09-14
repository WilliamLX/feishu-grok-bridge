/**
 * In-memory event-id deduplicator with TTL eviction.
 */
export class DedupeStore {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = 300_000) {
    this.ttlMs = ttlMs;
  }

  /** Returns true if this is the first time seeing `key` within TTL. */
  tryClaim(key: string, now = Date.now()): boolean {
    this.evict(now);
    const prev = this.seen.get(key);
    if (prev !== undefined && now - prev < this.ttlMs) {
      return false;
    }
    this.seen.set(key, now);
    return true;
  }

  has(key: string, now = Date.now()): boolean {
    const prev = this.seen.get(key);
    return prev !== undefined && now - prev < this.ttlMs;
  }

  size(): number {
    return this.seen.size;
  }

  clear(): void {
    this.seen.clear();
  }

  private evict(now: number): void {
    for (const [k, t] of this.seen) {
      if (now - t >= this.ttlMs) this.seen.delete(k);
    }
  }
}
