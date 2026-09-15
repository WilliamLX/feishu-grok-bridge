import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BridgeCore, sanitizeBackendErrorForUser } from '../src/core/bridge.js';
import type { AppConfig } from '../src/config.js';
import type { GrokBackend } from '../src/backend/types.js';
import type { IncomingMessage } from '../src/feishu/ws.js';
import { testBindings, testCatalog } from './helpers.js';

function baseCfg(over: Partial<AppConfig> = {}): AppConfig {
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

function msg(over: Partial<IncomingMessage> = {}): IncomingMessage {
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

describe('sanitizeBackendErrorForUser', () => {
  it('never echoes raw error details', () => {
    const s = sanitizeBackendErrorForUser(new Error('secret stack /api/key=abc'));
    expect(s).not.toMatch(/secret|api\/key/i);
    expect(s).toMatch(/backend/i);
  });
});

describe('BridgeCore ACL / mention / bootstrap', () => {
  const replies: string[] = [];
  const client = {
    im: {
      message: {
        reply: vi.fn(async () => ({ code: 0, msg: 'ok', data: { message_id: 'om_r' } })),
      },
    },
  } as unknown as import('@larksuiteoapi/node-sdk').Client;

  const backend: GrokBackend = {
    name: 'echo',
    handle: vi.fn(async () => ({ reply: 'ok' })),
  };

  beforeEach(() => {
    replies.length = 0;
    vi.mocked(client.im.message.reply).mockClear();
    vi.mocked(backend.handle).mockClear();
  });

  async function captureReply(bridge: BridgeCore, m: IncomingMessage) {
    await bridge.handleIncoming(m);
    const calls = vi.mocked(client.im.message.reply).mock.calls;
    return calls.map((c) => {
      const data = c[0]?.data as { content?: string; msg_type?: string } | undefined;
      return data?.content ?? '';
    });
  }

  it('allows bootstrap /whoami when ALLOW_FROM empty', async () => {
    const bridge = new BridgeCore({
      cfg: baseCfg({ allowFrom: [] }),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(),
    });
    const contents = await captureReply(
      bridge,
      msg({
        openId: 'ou_newbie',
        contentRaw: JSON.stringify({ text: '/whoami' }),
      }),
    );
    expect(contents.length).toBeGreaterThan(0);
    expect(contents.some((c) => c.includes('ou_newbie'))).toBe(true);
    expect(backend.handle).not.toHaveBeenCalled();
  });

  it('denies normal chat when ALLOW_FROM empty (with brief reply in DM)', async () => {
    const bridge = new BridgeCore({
      cfg: baseCfg({ allowFrom: [] }),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(),
    });
    const contents = await captureReply(
      bridge,
      msg({ openId: 'ou_newbie', contentRaw: JSON.stringify({ text: 'hi' }) }),
    );
    expect(backend.handle).not.toHaveBeenCalled();
    expect(contents.some((c) => /bootstrap|ALLOW_FROM|authorized/i.test(c))).toBe(true);
  });

  it('group: only exact bot open_id counts as mention', async () => {
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(['oc_g']),
    });
    // Mention someone else — should be denied silently (no reply for mention miss)
    await captureReply(
      bridge,
      msg({
        chatType: 'group',
        chatId: 'oc_g',
        contentRaw: JSON.stringify({ text: '@_user_1 hi' }),
        mentions: [{ key: '@_user_1', id: 'ou_alice', name: 'Alice' }],
      }),
    );
    expect(backend.handle).not.toHaveBeenCalled();

    // Mention bot — allowed
    await captureReply(
      bridge,
      msg({
        eventId: 'ev_bot_mention',
        chatType: 'group',
        chatId: 'oc_g',
        contentRaw: JSON.stringify({ text: '@_user_1 hi' }),
        mentions: [{ key: '@_user_1', id: 'ou_bot', name: 'Bot' }],
      }),
    );
    expect(backend.handle).toHaveBeenCalled();
  });

  it('group without botOpenId does not treat any mention as bot', async () => {
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      catalog: testCatalog(),
      bindings: testBindings(['oc_g']),
      // botOpenId undefined
    });
    await captureReply(
      bridge,
      msg({
        chatType: 'group',
        chatId: 'oc_g',
        contentRaw: JSON.stringify({ text: '@_user_1 hi' }),
        mentions: [{ key: '@_user_1', id: 'ou_someone', name: 'X' }],
      }),
    );
    expect(backend.handle).not.toHaveBeenCalled();
  });

  it('sanitizes backend errors in user reply', async () => {
    vi.mocked(backend.handle).mockRejectedValueOnce(new Error('INTERNAL leak token=abc'));
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(['oc_1']),
    });
    const contents = await captureReply(bridge, msg());
    const joined = contents.join('\n');
    expect(joined).not.toMatch(/token=abc|INTERNAL leak/);
    expect(joined).toMatch(/backend|wrong|try again/i);
  });

  it('rejects bootstrap /whoami in group when ALLOW_FROM empty (DM-only)', async () => {
    const bridge = new BridgeCore({
      cfg: baseCfg({ allowFrom: [] }),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(),
    });
    const contents = await captureReply(
      bridge,
      msg({
        openId: 'ou_newbie',
        chatType: 'group',
        chatId: 'oc_g',
        contentRaw: JSON.stringify({ text: '/whoami' }),
        mentions: [{ key: '@_user_1', id: 'ou_bot', name: 'Bot' }],
      }),
    );
    // Should not run whoami command successfully with open_id body in bootstrap sense —
    // ACL deny / bootstrap skip. Backend must not run.
    expect(backend.handle).not.toHaveBeenCalled();
    // Either silent/deny, but must NOT return whoami open_id dump as bootstrap success
    const joined = contents.join('\n');
    expect(joined).not.toMatch(/Bootstrap:/);
  });

  it('group: object-shaped mention id {open_id} counts as bot mention', async () => {
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(['oc_g']),
    });
    await captureReply(
      bridge,
      msg({
        eventId: 'ev_obj_mention',
        chatType: 'group',
        chatId: 'oc_g',
        contentRaw: JSON.stringify({ text: '@_user_1 hi' }),
        mentions: [
          {
            key: '@_user_1',
            id: { open_id: 'ou_bot' } as unknown as string,
            name: 'Bot',
          },
        ],
      }),
    );
    expect(backend.handle).toHaveBeenCalled();
  });

  it('ACL deny copy when allowlist non-empty does not tell user to /whoami', async () => {
    const bridge = new BridgeCore({
      cfg: baseCfg({ allowFrom: ['ou_alice'] }),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(),
    });
    const contents = await captureReply(
      bridge,
      msg({
        openId: 'ou_eve',
        contentRaw: JSON.stringify({ text: 'hi' }),
      }),
    );
    expect(backend.handle).not.toHaveBeenCalled();
    const joined = contents.join('\n');
    expect(joined).toMatch(/Not authorized|authorized/i);
    expect(joined).not.toMatch(/whoami/i);
  });

});
