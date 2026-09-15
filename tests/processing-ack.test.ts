import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BridgeCore, PROCESSING_ACK_TEXT } from '../src/core/bridge.js';
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
    sessionMaxHistory: 40,
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

function replyPayload(call: unknown): { msg_type?: string; content?: string } {
  const c = call as { data?: { msg_type?: string; content?: string } };
  return c?.data ?? {};
}

describe('processing ack', () => {
  const client = {
    im: {
      message: {
        reply: vi.fn(async () => ({ code: 0, msg: 'ok', data: { message_id: 'om_r' } })),
      },
    },
  } as unknown as import('@larksuiteoapi/node-sdk').Client;

  let backendResolve!: (v: { reply: string }) => void;
  let backendHandle!: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(client.im.message.reply).mockClear();
    backendHandle = vi.fn(
      () =>
        new Promise<{ reply: string }>((resolve) => {
          backendResolve = resolve;
        }),
    );
  });

  it('sends ack after ACL pass before backend resolves; final reply comes later', async () => {
    const backend: GrokBackend = { name: 'slow', handle: backendHandle };
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(['oc_1']),
    });

    const done = bridge.handleIncoming(msg({ contentRaw: JSON.stringify({ text: 'ping' }) }));

    // Allow microtasks / ack reply to flush while backend is still pending
    await vi.waitFor(() => {
      expect(client.im.message.reply).toHaveBeenCalled();
    });

    const first = replyPayload(vi.mocked(client.im.message.reply).mock.calls[0]![0]);
    expect(first.msg_type).toBe('text');
    expect(first.content).toContain(PROCESSING_ACK_TEXT);
    expect(backendHandle).toHaveBeenCalledTimes(1);

    // Final answer not yet sent
    expect(vi.mocked(client.im.message.reply).mock.calls.length).toBe(1);

    backendResolve({ reply: 'final-answer' });
    await done;

    expect(vi.mocked(client.im.message.reply).mock.calls.length).toBe(2);
    const second = replyPayload(vi.mocked(client.im.message.reply).mock.calls[1]![0]);
    expect(second.content).toMatch(/final-answer/);
  });

  it('does not send processing ack for slash commands', async () => {
    const backend: GrokBackend = {
      name: 'echo',
      handle: vi.fn(async () => ({ reply: 'should-not-run' })),
    };
    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(['oc_1']),
    });

    await bridge.handleIncoming(
      msg({ contentRaw: JSON.stringify({ text: '/help' }) }),
    );

    expect(backend.handle).not.toHaveBeenCalled();
    const contents = vi.mocked(client.im.message.reply).mock.calls.map((c) => {
      const p = replyPayload(c[0]);
      return p.content ?? '';
    });
    expect(contents.some((c) => c.includes(PROCESSING_ACK_TEXT))).toBe(false);
    expect(contents.some((c) => c.includes('/help') || c.includes('Help') || c.includes('帮助'))).toBe(
      true,
    );
  });

  it('does not send ack when ACL denies', async () => {
    const backend: GrokBackend = {
      name: 'echo',
      handle: vi.fn(async () => ({ reply: 'nope' })),
    };
    const bridge = new BridgeCore({
      cfg: baseCfg({ allowFrom: ['ou_alice'] }),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(['oc_1']),
    });

    await bridge.handleIncoming(
      msg({
        openId: 'ou_eve',
        contentRaw: JSON.stringify({ text: 'hi' }),
      }),
    );

    expect(backend.handle).not.toHaveBeenCalled();
    const contents = vi.mocked(client.im.message.reply).mock.calls.map((c) => {
      return replyPayload(c[0]).content ?? '';
    });
    expect(contents.some((c) => c.includes(PROCESSING_ACK_TEXT))).toBe(false);
  });

  it('serializes two messages in same chat: second ack only after first final', async () => {
    const order: string[] = [];
    const resolvers: Array<(v: { reply: string }) => void> = [];

    const backend: GrokBackend = {
      name: 'slow',
      handle: vi.fn((_req) => {
        const n = resolvers.length;
        order.push(`backend-start-${n}`);
        return new Promise<{ reply: string }>((resolve) => {
          resolvers.push((v) => {
            order.push(`backend-end-${n}`);
            resolve(v);
          });
        });
      }),
    };

    const replyFn = vi.fn(async (args: { data?: { content?: string; msg_type?: string } }) => {
      const content = args?.data?.content ?? '';
      const msgType = args?.data?.msg_type;
      if (msgType === 'text' && content.includes(PROCESSING_ACK_TEXT)) {
        order.push(`ack:${(args as { path?: { message_id?: string } }).path?.message_id ?? '?'}`);
      } else if (content.includes('answer-A')) {
        order.push('final-A');
      } else if (content.includes('answer-B')) {
        order.push('final-B');
      } else {
        order.push(`reply-other`);
      }
      return { code: 0, msg: 'ok', data: { message_id: 'om_r' } };
    });

    const slowClient = {
      im: { message: { reply: replyFn } },
    } as unknown as import('@larksuiteoapi/node-sdk').Client;

    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client: slowClient,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(['oc_same']),
    });

    const a = bridge.handleIncoming(
      msg({
        eventId: 'ev_a',
        messageId: 'om_a',
        chatId: 'oc_same',
        contentRaw: JSON.stringify({ text: 'first' }),
      }),
    );
    const b = bridge.handleIncoming(
      msg({
        eventId: 'ev_b',
        messageId: 'om_b',
        chatId: 'oc_same',
        contentRaw: JSON.stringify({ text: 'second' }),
      }),
    );

    await vi.waitFor(() => expect(resolvers.length).toBe(1));
    expect(order).toContain('ack:om_a');
    expect(order).toContain('backend-start-0');
    // Second must not have started yet (serial queue)
    expect(order).not.toContain('ack:om_b');
    expect(order).not.toContain('backend-start-1');

    resolvers[0]!({ reply: 'answer-A' });
    await a;

    await vi.waitFor(() => expect(resolvers.length).toBe(2));
    expect(order).toContain('final-A');
    expect(order).toContain('ack:om_b');
    expect(order).toContain('backend-start-1');

    resolvers[1]!({ reply: 'answer-B' });
    await b;

    expect(order).toContain('final-B');

    // Strict serial order: A ack → A backend → A final → B ack → B backend → B final
    const iAckA = order.indexOf('ack:om_a');
    const iStart0 = order.indexOf('backend-start-0');
    const iEnd0 = order.indexOf('backend-end-0');
    const iFinalA = order.indexOf('final-A');
    const iAckB = order.indexOf('ack:om_b');
    const iStart1 = order.indexOf('backend-start-1');
    const iFinalB = order.indexOf('final-B');

    expect(iAckA).toBeLessThan(iStart0);
    expect(iStart0).toBeLessThan(iEnd0);
    expect(iEnd0).toBeLessThan(iFinalA);
    expect(iFinalA).toBeLessThan(iAckB);
    expect(iAckB).toBeLessThan(iStart1);
    expect(iStart1).toBeLessThan(iFinalB);
  });

  it('second message does not clobber first turn history mid-flight', async () => {
    const seenHistories: string[][] = [];
    const resolvers: Array<(v: { reply: string }) => void> = [];

    const backend: GrokBackend = {
      name: 'slow',
      handle: vi.fn(async (req) => {
        seenHistories.push(req.history.map((h) => `${h.role}:${h.content}`));
        return new Promise<{ reply: string }>((resolve) => {
          resolvers.push(resolve);
        });
      }),
    };

    const bridge = new BridgeCore({
      cfg: baseCfg(),
      client,
      backend,
      botOpenId: 'ou_bot',
      catalog: testCatalog(),
      bindings: testBindings(['oc_hist']),
    });

    const a = bridge.handleIncoming(
      msg({
        eventId: 'ev_h1',
        messageId: 'om_h1',
        chatId: 'oc_hist',
        contentRaw: JSON.stringify({ text: 'msg-one' }),
      }),
    );
    const b = bridge.handleIncoming(
      msg({
        eventId: 'ev_h2',
        messageId: 'om_h2',
        chatId: 'oc_hist',
        contentRaw: JSON.stringify({ text: 'msg-two' }),
      }),
    );

    await vi.waitFor(() => expect(resolvers.length).toBe(1));
    // First backend call sees only msg-one (not msg-two interleaved)
    expect(seenHistories[0]).toEqual(['user:msg-one']);

    resolvers[0]!({ reply: 'reply-one' });
    await a;

    await vi.waitFor(() => expect(resolvers.length).toBe(2));
    expect(seenHistories[1]).toEqual([
      'user:msg-one',
      'assistant:reply-one',
      'user:msg-two',
    ]);

    resolvers[1]!({ reply: 'reply-two' });
    await b;
  });
});
