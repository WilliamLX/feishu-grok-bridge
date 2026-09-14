import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchBotInfo, fetchTenantTokenHttp } from '../src/feishu/auth.js';

describe('Feishu HTTP timeouts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchBotInfo fails fast when bot/v3/info stalls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }),
    );

    const started = Date.now();
    const res = await fetchBotInfo({
      appId: 'cli_x',
      appSecret: 'sec',
      domain: 'feishu',
      tenantAccessToken: 't-prefetched',
      timeoutMs: 50,
    });
    const elapsed = Date.now() - started;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timeout/i);
    expect(elapsed).toBeLessThan(2000);
  });

  it('fetchTenantTokenHttp fails fast when auth stalls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }),
    );

    const res = await fetchTenantTokenHttp({
      appId: 'cli_x',
      appSecret: 'sec',
      domain: 'feishu',
      timeoutMs: 50,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timeout/i);
  });
});
