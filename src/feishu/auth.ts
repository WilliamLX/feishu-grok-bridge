import * as lark from '@larksuiteoapi/node-sdk';
import { log } from '../logger.js';

export type FeishuDomain = 'feishu' | 'lark';

export function domainBase(domain: FeishuDomain): string {
  return domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
}

export function createLarkClient(opts: {
  appId: string;
  appSecret: string;
  domain: FeishuDomain;
}): lark.Client {
  const domain = opts.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;

  return new lark.Client({
    appId: opts.appId,
    appSecret: opts.appSecret,
    domain,
    loggerLevel: lark.LoggerLevel.info,
  });
}

/**
 * Direct HTTP fetch of tenant_access_token (for doctor / diagnostics).
 * Never logs the secret or full token.
 */
export async function fetchTenantTokenHttp(opts: {
  appId: string;
  appSecret: string;
  domain: FeishuDomain;
}): Promise<{ ok: boolean; expire?: number; error?: string }> {
  const base = domainBase(opts.domain);
  const url = `${base}/open-apis/auth/v3/tenant_access_token/internal`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app_id: opts.appId,
        app_secret: opts.appSecret,
      }),
    });
    const json = (await res.json()) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };
    if (json.code !== 0 || !json.tenant_access_token) {
      return { ok: false, error: `code=${json.code} msg=${json.msg ?? 'unknown'}` };
    }
    log.debug('tenant_access_token ok', {
      expire: json.expire,
      len: json.tenant_access_token.length,
    });
    return { ok: true, expire: json.expire };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Alias kept for callers expecting “fetchTenantAccessToken”. */
export const fetchTenantAccessToken = fetchTenantTokenHttp;
