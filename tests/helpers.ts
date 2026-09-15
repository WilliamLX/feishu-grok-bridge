import type { AppConfig } from '../src/config.js';
import type { IncomingMessage } from '../src/feishu/ws.js';
import { BotCatalog } from '../src/core/bots.js';
import { MemoryBindingStore } from '../src/core/binding.js';

export const TEST_BOT = {
  id: 'echo-1',
  name: 'Echo One',
  description: 'test agent',
  enabled: true,
};

export const TEST_BOT_B = {
  id: 'echo-2',
  name: 'Echo Two',
  description: 'second test agent',
  enabled: true,
};

export function baseCfg(over: Partial<AppConfig> = {}): AppConfig {
  return {
    feishuAppId: 'cli_x',
    feishuAppSecret: 'sec',
    feishuDomain: 'feishu',
    allowFrom: ['ou_alice'],
    allowChats: [],
    requireMention: true,
    grokBackend: 'echo',
    grokBotWebhookUrl: '',
    grokBotWebhookToken: '',
    grokHttpTimeoutMs: 1000,
    sessionMaxHistory: 10,
    sessionIdleTtlMs: 60_000,
    sessionMaxCount: 50,
    dedupeTtlMs: 60_000,
    logLevel: 'error',
    botCatalogPath: 'bots.json',
    bindingStorePath: 'data/bindings.json',
    ...over,
  };
}

export function msg(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    eventId: `ev_${Math.random()}`,
    messageId: 'om_1',
    chatId: 'oc_1',
    chatType: 'p2p',
    openId: 'ou_alice',
    contentRaw: JSON.stringify({ text: 'hello' }),
    mentions: [],
    ...over,
  };
}

export function testCatalog() {
  return BotCatalog.fromEntries([TEST_BOT, TEST_BOT_B]);
}

export function testBindings(chatIds: string[] = ['oc_1'], agentId = TEST_BOT.id) {
  const s = new MemoryBindingStore();
  for (const id of chatIds) s.bind(id, agentId);
  return s;
}
