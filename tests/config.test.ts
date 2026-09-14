import { describe, it, expect } from 'vitest';
import { loadConfig, missingRequired, redactSecrets } from '../src/config.js';

describe('loadConfig / missingRequired', () => {
  it('defaults; empty ALLOW_FROM does not block start (bootstrap)', () => {
    const cfg = loadConfig({
      FEISHU_APP_ID: '',
      FEISHU_APP_SECRET: '',
      ALLOW_FROM: '',
      GROK_BACKEND: 'echo',
    } as NodeJS.ProcessEnv);
    expect(cfg.allowFrom).toEqual([]);
    expect(cfg.requireMention).toBe(true);
    expect(cfg.grokBackend).toBe('echo');
    expect(cfg.sessionIdleTtlMs).toBe(3_600_000);
    expect(cfg.sessionMaxCount).toBe(500);

    const miss = missingRequired(cfg, 'start');
    expect(miss.some((m) => m.startsWith('FEISHU_APP_ID'))).toBe(true);
    expect(miss.some((m) => m.startsWith('ALLOW_FROM'))).toBe(false);
  });

  it('parses allowlists and requires webhook for http', () => {
    const cfg = loadConfig({
      FEISHU_APP_ID: 'cli_x',
      FEISHU_APP_SECRET: 'sec',
      ALLOW_FROM: 'ou_a, ou_b',
      ALLOW_CHATS: 'oc_1',
      GROK_BACKEND: 'http',
      GROK_BOT_WEBHOOK_URL: '',
      REQUIRE_MENTION: 'false',
      SESSION_IDLE_TTL_MS: '60000',
      SESSION_MAX_COUNT: '10',
    } as NodeJS.ProcessEnv);
    expect(cfg.allowFrom).toEqual(['ou_a', 'ou_b']);
    expect(cfg.allowChats).toEqual(['oc_1']);
    expect(cfg.requireMention).toBe(false);
    expect(cfg.sessionIdleTtlMs).toBe(60_000);
    expect(cfg.sessionMaxCount).toBe(10);
    const miss = missingRequired(cfg, 'doctor');
    expect(miss.some((m) => m.includes('GROK_BOT_WEBHOOK_URL'))).toBe(true);
  });

  it('redacts secrets', () => {
    const cfg = loadConfig({
      FEISHU_APP_ID: 'cli_abcdefgh',
      FEISHU_APP_SECRET: 'supersecret',
      GROK_BOT_WEBHOOK_TOKEN: 'tok',
      ALLOW_FROM: 'ou_a',
    } as NodeJS.ProcessEnv);
    const r = redactSecrets(cfg);
    expect(r.feishuAppSecret).toBe('***');
    expect(r.grokBotWebhookToken).toBe('***');
    expect(String(r.feishuAppId)).toContain('…');
  });
});
