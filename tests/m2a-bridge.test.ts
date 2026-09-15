import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BridgeCore, PROCESSING_ACK_TEXT } from '../src/core/bridge.js';
import type { GrokBackend } from '../src/backend/types.js';
import { MemoryBindingStore } from '../src/core/binding.js';
import { SELECT_BOT_ACTION } from '../src/feishu/card.js';
import {
  baseCfg,
  msg,
  testCatalog,
  testBindings,
  TEST_BOT,
  TEST_BOT_B,
} from './helpers.js';

function replyContents(client: { im: { message: { reply: ReturnType<typeof vi.fn> } } }) {
  return vi.mocked(client.im.message.reply).mock.calls.map((c) => {
    const data = c[0]?.data as { content?: string; msg_type?: string } | undefined;
    return data?.content ?? '';
  });
}

describe('M2a select bot / bind / fail-closed', () => {
  const client = {
    im: {
      message: {
        reply: vi.fn(async () => ({ code: 0, msg: 'ok', data: { message_id: 'om_r' } })),
      },
    },
  } as unknown as import('@larksuiteoapi/node-sdk').Client;

  const backend: GrokBackend = {
    name: 'echo',
    handle: vi.fn(async (req) => ({ reply: `ok:${req.agentId}:${req.text}` })),
  };

  beforeEach(() => {
    vi.mocked(client.im.message.reply).mockClear();
    vi.mocked(backend.handle).mockClear();
  });

  it('unbound chat does not call backend and guides to /bots', async () => {
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: new MemoryBindingStore(),
    });
    await bridge.handleIncoming(msg());
    expect(backend.handle).not.toHaveBeenCalled();
    const joined = replyContents(client).join('\n');
    expect(joined).toMatch(/\/bots/);
    expect(joined).not.toContain(PROCESSING_ACK_TEXT);
  });

  it('/bot binds and subsequent chat sends that agentId', async () => {
    const bindings = new MemoryBindingStore();
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings,
    });
    await bridge.handleIncoming(
      msg({ contentRaw: JSON.stringify({ text: `/bot ${TEST_BOT.id}` }) }),
    );
    expect(bindings.get('oc_1')?.agentId).toBe(TEST_BOT.id);
    expect(bindings.epoch('oc_1')).toBe(1);
    expect(backend.handle).not.toHaveBeenCalled();

    await bridge.handleIncoming(
      msg({
        eventId: 'ev_chat',
        contentRaw: JSON.stringify({ text: 'hello' }),
      }),
    );
    expect(backend.handle).toHaveBeenCalledOnce();
    expect(vi.mocked(backend.handle).mock.calls[0]![0].agentId).toBe(TEST_BOT.id);
  });

  it('/new clears history but keeps binding', async () => {
    const bindings = testBindings(['oc_1']);
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings,
    });
    await bridge.handleIncoming(msg({ contentRaw: JSON.stringify({ text: 'hello' }) }));
    expect(backend.handle).toHaveBeenCalled();
    await bridge.handleIncoming(
      msg({
        eventId: 'ev_new',
        contentRaw: JSON.stringify({ text: '/new' }),
      }),
    );
    expect(bindings.get('oc_1')?.agentId).toBe(TEST_BOT.id);
    const joined = replyContents(client).join('\n');
    expect(joined).toMatch(/绑定未改|Echo One/);
  });

  it('unknown agentId errors and never calls backend with a default', async () => {
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: new MemoryBindingStore(),
    });
    await bridge.handleIncoming(
      msg({ contentRaw: JSON.stringify({ text: '/bot not-a-real-agent' }) }),
    );
    expect(backend.handle).not.toHaveBeenCalled();
    const joined = replyContents(client).join('\n');
    expect(joined).toMatch(/未知或已停用/);
    expect(joined).toMatch(/不会使用默认 Bot/);
  });

  it('stale bound agentId (removed from catalog) fail-closed', async () => {
    const bindings = new MemoryBindingStore();
    bindings.bind('oc_1', 'deleted-agent');
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings,
    });
    await bridge.handleIncoming(msg());
    expect(backend.handle).not.toHaveBeenCalled();
    expect(replyContents(client).join('\n')).toMatch(/deleted-agent|未知或已停用/);
  });

  it('card action binds agent after ACL', async () => {
    const bindings = new MemoryBindingStore();
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings,
    });
    await bridge.handleCardAction({
      eventId: 'ev_card',
      openId: 'ou_alice',
      chatId: 'oc_1',
      messageId: 'om_card',
      chatType: 'p2p',
      action: SELECT_BOT_ACTION,
      agentId: TEST_BOT_B.id,
    });
    expect(bindings.get('oc_1')?.agentId).toBe(TEST_BOT_B.id);
    expect(backend.handle).not.toHaveBeenCalled();
  });

  it('card action denied for users not on ALLOW_FROM', async () => {
    const bindings = new MemoryBindingStore();
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings,
    });
    await bridge.handleCardAction({
      eventId: 'ev_card_eve',
      openId: 'ou_eve',
      chatId: 'oc_1',
      messageId: 'om_card',
      chatType: 'p2p',
      action: SELECT_BOT_ACTION,
      agentId: TEST_BOT.id,
    });
    expect(bindings.get('oc_1')).toBeUndefined();
  });

  it('switching bot drops in-flight reply from the old agent', async () => {
    let resolveA!: (v: { reply: string }) => void;
    const slow: GrokBackend = {
      name: 'slow',
      handle: vi.fn(
        () =>
          new Promise<{ reply: string }>((r) => {
            resolveA = r;
          }),
      ),
    };
    const bindings = testBindings(['oc_1'], TEST_BOT.id);
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend: slow,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings,
    });

    const first = bridge.handleIncoming(
      msg({
        eventId: 'ev_inflight',
        contentRaw: JSON.stringify({ text: 'slow-turn' }),
      }),
    );
    await vi.waitFor(() => expect(slow.handle).toHaveBeenCalledOnce());

    const switchP = bridge.handleIncoming(
      msg({
        eventId: 'ev_switch',
        messageId: 'om_switch',
        contentRaw: JSON.stringify({ text: `/bot ${TEST_BOT_B.id}` }),
      }),
    );

    resolveA({ reply: 'OLD-AGENT-SHOULD-NOT-POST' });
    await first;
    await switchP;

    const joined = replyContents(client).join('\n');
    expect(joined).not.toMatch(/OLD-AGENT-SHOULD-NOT-POST/);
    expect(bindings.get('oc_1')?.agentId).toBe(TEST_BOT_B.id);
    expect(bindings.epoch('oc_1')).toBe(2);
  });

  it('drops messages queued before a bot switch instead of rerouting them', async () => {
    let resolveFirst!: (v: { reply: string }) => void;
    const backend: GrokBackend = {
      name: 'slow',
      handle: vi.fn((req) => {
        if (req.text === 'first') {
          return new Promise<{ reply: string }>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({ reply: `reply:${req.agentId}:${req.text}` });
      }),
    };
    const bindings = testBindings(['oc_1'], TEST_BOT.id);
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings,
    });

    const first = bridge.handleIncoming(
      msg({
        eventId: 'ev_first',
        contentRaw: JSON.stringify({ text: 'first' }),
      }),
    );
    await vi.waitFor(() => expect(backend.handle).toHaveBeenCalledOnce());

    const queued = bridge.handleIncoming(
      msg({
        eventId: 'ev_queued',
        contentRaw: JSON.stringify({ text: 'queued-before-switch' }),
      }),
    );
    const switched = bridge.handleIncoming(
      msg({
        eventId: 'ev_switch_queued',
        messageId: 'om_switch_queued',
        contentRaw: JSON.stringify({ text: `/bot ${TEST_BOT_B.id}` }),
      }),
    );

    resolveFirst({ reply: 'old-reply' });
    await Promise.all([first, queued, switched]);

    expect(backend.handle).toHaveBeenCalledOnce();
    expect(replyContents(client).join('\n')).not.toMatch(/queued-before-switch/);
    expect(bindings.get('oc_1')?.agentId).toBe(TEST_BOT_B.id);
  });

  it('/status shows bound bot', async () => {
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(['oc_1']),
    });
    await bridge.handleIncoming(msg({ contentRaw: JSON.stringify({ text: '/status' }) }));
    const joined = replyContents(client).join('\n');
    expect(joined).toMatch(/Echo One/);
    expect(joined).toMatch(/echo-1/);
  });
});
