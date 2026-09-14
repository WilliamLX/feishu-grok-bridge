import type * as lark from '@larksuiteoapi/node-sdk';
import { log } from '../logger.js';

export type SendResult = { ok: true; messageId?: string } | { ok: false; error: string };

/** Build a simple markdown-like interactive card. */
export function buildReplyCard(title: string, markdown: string): Record<string, unknown> {
  // Truncate very long content for Feishu card limits (~4k-ish safe)
  const body = markdown.length > 3500 ? markdown.slice(0, 3500) + '\n\n…(truncated)' : markdown;
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template: 'blue',
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: body },
      },
    ],
  };
}

export async function replyText(
  client: lark.Client,
  opts: { messageId: string; text: string },
): Promise<SendResult> {
  try {
    const res = await client.im.message.reply({
      path: { message_id: opts.messageId },
      data: {
        content: JSON.stringify({ text: opts.text }),
        msg_type: 'text',
      },
    });
    if (res.code !== 0) {
      return { ok: false, error: `reply text code=${res.code} msg=${res.msg}` };
    }
    const messageId = (res.data as { message_id?: string } | undefined)?.message_id;
    return { ok: true, messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function replyCard(
  client: lark.Client,
  opts: { messageId: string; card: Record<string, unknown> },
): Promise<SendResult> {
  try {
    const res = await client.im.message.reply({
      path: { message_id: opts.messageId },
      data: {
        content: JSON.stringify(opts.card),
        msg_type: 'interactive',
      },
    });
    if (res.code !== 0) {
      return { ok: false, error: `reply card code=${res.code} msg=${res.msg}` };
    }
    const messageId = (res.data as { message_id?: string } | undefined)?.message_id;
    return { ok: true, messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Prefer card reply; fall back to plain text on failure.
 */
export async function replyPreferCard(
  client: lark.Client,
  opts: { messageId: string; text: string; title?: string; card?: Record<string, unknown> },
): Promise<SendResult> {
  const card = opts.card ?? buildReplyCard(opts.title ?? 'Grok', opts.text);
  const cardRes = await replyCard(client, { messageId: opts.messageId, card });
  if (cardRes.ok) return cardRes;

  log.warn('card reply failed, falling back to text', { error: cardRes.error });
  return replyText(client, { messageId: opts.messageId, text: opts.text });
}

export async function sendTextToChat(
  client: lark.Client,
  opts: { chatId: string; text: string },
): Promise<SendResult> {
  try {
    const res = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: opts.chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: opts.text }),
      },
    });
    if (res.code !== 0) {
      return { ok: false, error: `send text code=${res.code} msg=${res.msg}` };
    }
    return { ok: true, messageId: (res.data as { message_id?: string })?.message_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
