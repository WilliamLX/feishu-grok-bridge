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
}): Promise<{ ok: boolean; expire?: number; token?: string; error?: string }> {
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
    return { ok: true, expire: json.expire, token: json.tenant_access_token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Alias kept for callers expecting “fetchTenantAccessToken”. */
export const fetchTenantAccessToken = fetchTenantTokenHttp;

/**
 * Resolve the bot's open_id via GET /open-apis/bot/v3/info.
 * Used so group @mention matching is exact (REQUIRE_MENTION).
 */
export async function fetchBotInfo(opts: {
  appId: string;
  appSecret: string;
  domain: FeishuDomain;
  /** Optional pre-fetched token to avoid a second auth round-trip. */
  tenantAccessToken?: string;
}): Promise<{ ok: boolean; openId?: string; appName?: string; error?: string }> {
  let token = opts.tenantAccessToken;
  if (!token) {
    const auth = await fetchTenantTokenHttp(opts);
    if (!auth.ok || !auth.token) {
      return { ok: false, error: auth.error ?? 'tenant_access_token failed' };
    }
    token = auth.token;
  }

  const base = domainBase(opts.domain);
  const url = `${base}/open-apis/bot/v3/info`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as {
      code?: number;
      msg?: string;
      bot?: { open_id?: string; app_name?: string };
    };
    if (json.code !== 0 || !json.bot?.open_id) {
      return {
        ok: false,
        error: `code=${json.code} msg=${json.msg ?? 'unknown'} (missing open_id)`,
      };
    }
    log.info('resolved bot open_id', {
      openId: `${json.bot.open_id.slice(0, 8)}…`,
      appName: json.bot.app_name,
    });
    return { ok: true, openId: json.bot.open_id, appName: json.bot.app_name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
