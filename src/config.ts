import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

function splitCsv(v: string | undefined): string[] {
  if (!v || !v.trim()) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const boolFromEnv = (defaultValue: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return defaultValue;
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'off'].includes(s)) return false;
    return defaultValue;
  }, z.boolean());

const EnvSchema = z.object({
  FEISHU_APP_ID: z.string().optional().default(''),
  FEISHU_APP_SECRET: z.string().optional().default(''),
  FEISHU_DOMAIN: z.enum(['feishu', 'lark']).default('feishu'),
  ALLOW_FROM: z.string().optional().default(''),
  ALLOW_CHATS: z.string().optional().default(''),
  REQUIRE_MENTION: boolFromEnv(true),
  GROK_BACKEND: z.enum(['echo', 'http', 'cursor-agent']).default('echo'),
  GROK_BOT_WEBHOOK_URL: z.string().optional().default(''),
  GROK_BOT_WEBHOOK_TOKEN: z.string().optional().default(''),
  GROK_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  SESSION_MAX_HISTORY: z.coerce.number().int().positive().default(20),
  SESSION_IDLE_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
  SESSION_MAX_COUNT: z.coerce.number().int().positive().default(500),
  DEDUPE_TTL_MS: z.coerce.number().int().positive().default(300_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppConfig = {
  feishuAppId: string;
  feishuAppSecret: string;
  feishuDomain: 'feishu' | 'lark';
  allowFrom: string[];
  allowChats: string[];
  requireMention: boolean;
  grokBackend: 'echo' | 'http' | 'cursor-agent';
  grokBotWebhookUrl: string;
  grokBotWebhookToken: string;
  grokHttpTimeoutMs: number;
  sessionMaxHistory: number;
  sessionIdleTtlMs: number;
  sessionMaxCount: number;
  dedupeTtlMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  return {
    feishuAppId: parsed.FEISHU_APP_ID,
    feishuAppSecret: parsed.FEISHU_APP_SECRET,
    feishuDomain: parsed.FEISHU_DOMAIN,
    allowFrom: splitCsv(parsed.ALLOW_FROM),
    allowChats: splitCsv(parsed.ALLOW_CHATS),
    requireMention: parsed.REQUIRE_MENTION,
    grokBackend: parsed.GROK_BACKEND,
    grokBotWebhookUrl: parsed.GROK_BOT_WEBHOOK_URL,
    grokBotWebhookToken: parsed.GROK_BOT_WEBHOOK_TOKEN,
    grokHttpTimeoutMs: parsed.GROK_HTTP_TIMEOUT_MS,
    sessionMaxHistory: parsed.SESSION_MAX_HISTORY,
    sessionIdleTtlMs: parsed.SESSION_IDLE_TTL_MS,
    sessionMaxCount: parsed.SESSION_MAX_COUNT,
    dedupeTtlMs: parsed.DEDUPE_TTL_MS,
    logLevel: parsed.LOG_LEVEL,
  };
}

/**
 * Missing required env keys for a given mode. Never returns secret values.
 * ALLOW_FROM is intentionally NOT required for start — empty allowlist stays
 * fail-closed for normal chat, but bootstrap `/whoami` is permitted at runtime.
 */
export function missingRequired(cfg: AppConfig, mode: 'doctor' | 'start' = 'start'): string[] {
  const missing: string[] = [];
  if (!cfg.feishuAppId) missing.push('FEISHU_APP_ID');
  if (!cfg.feishuAppSecret) missing.push('FEISHU_APP_SECRET');
  if (cfg.grokBackend === 'http' && !cfg.grokBotWebhookUrl) {
    missing.push('GROK_BOT_WEBHOOK_URL (required when GROK_BACKEND=http)');
  }
  void mode;
  return missing;
}

export function redactSecrets(cfg: AppConfig): Record<string, unknown> {
  return {
    feishuAppId: cfg.feishuAppId ? `${cfg.feishuAppId.slice(0, 8)}…` : '(empty)',
    feishuAppSecret: cfg.feishuAppSecret ? '***' : '(empty)',
    feishuDomain: cfg.feishuDomain,
    allowFromCount: cfg.allowFrom.length,
    allowChatsCount: cfg.allowChats.length,
    requireMention: cfg.requireMention,
    grokBackend: cfg.grokBackend,
    grokBotWebhookUrl: cfg.grokBotWebhookUrl || '(empty)',
    grokBotWebhookToken: cfg.grokBotWebhookToken ? '***' : '(empty)',
    grokHttpTimeoutMs: cfg.grokHttpTimeoutMs,
    sessionMaxHistory: cfg.sessionMaxHistory,
    sessionIdleTtlMs: cfg.sessionIdleTtlMs,
    sessionMaxCount: cfg.sessionMaxCount,
    dedupeTtlMs: cfg.dedupeTtlMs,
    logLevel: cfg.logLevel,
  };
}
