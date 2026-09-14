/**
 * Future multi-IM adapter interface (DingTalk, WeCom, etc.).
 * Feishu implementation lives under src/feishu; this is the seam.
 */

export type ImIncomingMessage = {
  platform: 'feishu' | 'dingtalk' | 'wecom' | string;
  eventId: string;
  messageId: string;
  chatId: string;
  chatType: string;
  userId: string;
  text: string;
  mentionedBot: boolean;
  raw?: unknown;
};

export type ImReply =
  | { type: 'text'; text: string }
  | { type: 'card'; card: Record<string, unknown>; fallbackText: string };

export interface ImAdapter {
  readonly platform: string;
  start(onMessage: (msg: ImIncomingMessage) => Promise<void>): Promise<{ stop: () => void }>;
  reply(messageId: string, reply: ImReply): Promise<void>;
}

/** Placeholder for a future DingTalk adapter. */
export class DingTalkAdapterStub implements ImAdapter {
  readonly platform = 'dingtalk';

  async start(): Promise<{ stop: () => void }> {
    throw new Error('DingTalkAdapter not implemented yet — TODO');
  }

  async reply(): Promise<void> {
    throw new Error('DingTalkAdapter not implemented yet — TODO');
  }
}
