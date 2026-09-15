import type { BotEntry } from '../core/bots.js';

export const SELECT_BOT_ACTION = 'select_bot';

/** Interactive card: one button per enabled bot. */
export function buildBotPickerCard(
  bots: BotEntry[],
  currentAgentId?: string,
): Record<string, unknown> {
  const lines =
    bots.length === 0
      ? '目录为空。'
      : bots
          .map((b) => {
            const mark = b.id === currentAgentId ? ' ← 当前' : '';
            const desc = b.description ? ` — ${b.description}` : '';
            return `• **${b.name}** (\`${b.id}\`)${desc}${mark}`;
          })
          .join('\n');

  const actions = bots.slice(0, 12).map((b) => ({
    tag: 'button',
    type: b.id === currentAgentId ? 'primary' : 'default',
    text: { tag: 'plain_text', content: b.name.slice(0, 20) },
    value: {
      action: SELECT_BOT_ACTION,
      agentId: b.id,
    },
  }));

  const elements: unknown[] = [
    {
      tag: 'div',
      text: { tag: 'lark_md', content: lines },
    },
  ];

  if (actions.length > 0) {
    // Feishu action rows work well with up to 5 buttons; chunk.
    for (let i = 0; i < actions.length; i += 5) {
      elements.push({
        tag: 'action',
        actions: actions.slice(i, i + 5),
      });
    }
  }

  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: '也可发送 /bot <id>。切换 Bot 会清空本会话历史。',
      },
    ],
  });

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '选择 Bot' },
      template: 'blue',
    },
    elements,
  };
}

export type IncomingCardAction = {
  eventId: string;
  openId: string;
  chatId: string;
  messageId: string;
  chatType: string;
  agentId?: string;
  action?: string;
};

function asString(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

function parseValue(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown;
      return parseValue(p);
    } catch {
      return {};
    }
  }
  if (typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Normalize Feishu `card.action.trigger` (schema 2.0) or SDK-unwrapped event.
 */
export function normalizeCardAction(data: unknown): IncomingCardAction | null {
  if (!data || typeof data !== 'object') return null;
  const root = data as Record<string, unknown>;
  const nested =
    root.event && typeof root.event === 'object'
      ? (root.event as Record<string, unknown>)
      : root;
  const header =
    root.header && typeof root.header === 'object'
      ? (root.header as Record<string, unknown>)
      : undefined;

  const operator =
    nested.operator && typeof nested.operator === 'object'
      ? (nested.operator as Record<string, unknown>)
      : {};
  const action =
    nested.action && typeof nested.action === 'object'
      ? (nested.action as Record<string, unknown>)
      : {};
  const context =
    nested.context && typeof nested.context === 'object'
      ? (nested.context as Record<string, unknown>)
      : {};

  const value = parseValue(action.value);
  const openId = asString(operator.open_id) || asString(context.open_id);
  const chatId = asString(context.open_chat_id);
  const messageId = asString(context.open_message_id);
  if (!openId || !chatId) return null;

  const eventId =
    asString(root.event_id) ||
    asString(header?.event_id) ||
    asString(nested.token) ||
    `${chatId}:${messageId}:${value.agentId ?? ''}`;

  return {
    eventId,
    openId,
    chatId,
    messageId,
    chatType: asString(context.chat_type) || 'p2p',
    action: value.action,
    agentId: value.agentId,
  };
}
