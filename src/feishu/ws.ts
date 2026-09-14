import * as lark from '@larksuiteoapi/node-sdk';
import { log } from '../logger.js';

export type IncomingMessage = {
  eventId: string;
  messageId: string;
  chatId: string;
  chatType: string;
  openId: string;
  contentRaw: string;
  mentions: Array<{ key?: string; id?: string; name?: string }>;
  parentId?: string;
  createTime?: string;
};

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

/**
 * Start Feishu/Lark WebSocket long-connection event client.
 * Uses @larksuiteoapi/node-sdk WSClient — no public IP required.
 */
export function startWsClient(opts: {
  appId: string;
  appSecret: string;
  domain: 'feishu' | 'lark';
  onMessage: MessageHandler;
}): { stop: () => void } {
  const domain = opts.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;

  const eventDispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      try {
        const msg = normalizeReceiveV1(data);
        if (!msg) {
          log.debug('ignored non-text or malformed message event');
          return;
        }
        await opts.onMessage(msg);
      } catch (e) {
        log.error('message handler error', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
  });

  const wsClient = new lark.WSClient({
    appId: opts.appId,
    appSecret: opts.appSecret,
    domain,
    loggerLevel: lark.LoggerLevel.info,
  });

  log.info('starting Feishu WS long connection…', { domain: opts.domain });
  // start() is async / fire-and-forget reconnect loop
  void wsClient.start({ eventDispatcher });

  return {
    stop: () => {
      try {
        // SDK may expose close; guard for version differences
        const anyWs = wsClient as unknown as { close?: () => void; stop?: () => void };
        anyWs.close?.();
        anyWs.stop?.();
        log.info('WS client stop requested');
      } catch (e) {
        log.warn('WS stop error', { error: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}

/** Normalize SDK event payload into IncomingMessage. Exported for tests. */
export function normalizeReceiveV1(data: unknown): IncomingMessage | null {
  const d = data as {
    sender?: {
      sender_id?: { open_id?: string; user_id?: string };
      sender_type?: string;
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      content?: string;
      message_type?: string;
      mentions?: Array<{ key?: string; id?: string; name?: string }>;
      parent_id?: string;
      create_time?: string;
    };
  };

  const message = d.message;
  if (!message?.message_id || !message.chat_id) return null;

  // Only handle text for MVP
  if (message.message_type && message.message_type !== 'text') {
    return null;
  }

  const openId = d.sender?.sender_id?.open_id ?? '';
  // Ignore bot/system senders without open_id
  if (!openId) return null;

  const eventId =
    (data as { event_id?: string }).event_id ??
    message.message_id;

  return {
    eventId,
    messageId: message.message_id,
    chatId: message.chat_id,
    chatType: message.chat_type ?? 'p2p',
    openId,
    contentRaw: message.content ?? '',
    mentions: message.mentions ?? [],
    parentId: message.parent_id,
    createTime: message.create_time,
  };
}
