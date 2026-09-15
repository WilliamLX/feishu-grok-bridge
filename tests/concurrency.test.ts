import { describe, it, expect } from 'vitest';
import { ChatConcurrency } from '../src/core/concurrency.js';

describe('ChatConcurrency', () => {
  it('serializes jobs per chatId', async () => {
    const c = new ChatConcurrency();
    const order: string[] = [];

    const a = c.run('chat1', async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('a-end');
      return 1;
    });
    const b = c.run('chat1', async () => {
      order.push('b-start');
      order.push('b-end');
      return 2;
    });
    const other = c.run('chat2', async () => {
      order.push('c');
      return 3;
    });

    const [ra, rb, rc] = await Promise.all([a, b, other]);
    expect(ra).toBe(1);
    expect(rb).toBe(2);
    expect(rc).toBe(3);
    expect(order.indexOf('a-end')).toBeLessThan(order.indexOf('b-start'));
    expect(order).toContain('c');
  });

  it('clears pending count after the last job finishes', async () => {
    const c = new ChatConcurrency();

    await c.run('chat1', async () => {
      expect(c.pendingCount()).toBe(1);
    });

    expect(c.pendingCount()).toBe(0);
  });
});
