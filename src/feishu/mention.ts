/**
 * Strip @bot mentions from Feishu message text / rich content.
 */

export type MentionInfo = {
  /** Raw text with mentions possibly present */
  text: string;
  /** Whether the bot was @mentioned */
  mentionedBot: boolean;
  /** Mentions found in message */
  mentions: Array<{ key: string; id: string; name?: string }>;
};

type FeishuMention = {
  key?: string;
  id?: string;
  name?: string;
  tenant_key?: string;
};

type MessageEventLike = {
  message?: {
    content?: string;
    mentions?: FeishuMention[];
    chat_type?: string;
  };
  sender?: {
    sender_id?: { open_id?: string; user_id?: string };
  };
};

/**
 * Parse text message content JSON `{"text":"..."}` and detect @bot.
 * Bot mentions in Feishu use keys like `@_user_1` mapped in `mentions[]`
 * where mention id equals the bot's open_id (or empty for @all).
 *
 * When `botOpenId` is omitted, `mentionedBot` stays false — callers must not
 * treat arbitrary mentions as addressing the bot.
 */
export function parseMentions(
  event: MessageEventLike,
  botOpenId?: string,
): MentionInfo {
  const mentions = (event.message?.mentions ?? []).map((m) => ({
    key: m.key ?? '',
    id: m.id ?? '',
    name: m.name,
  }));

  let text = '';
  const raw = event.message?.content ?? '';
  try {
    const parsed = JSON.parse(raw) as { text?: string };
    text = parsed.text ?? raw;
  } catch {
    text = raw;
  }

  let mentionedBot = false;
  if (botOpenId) {
    mentionedBot = mentions.some((m) => m.id && m.id === botOpenId);
  }

  // Strip mention placeholders like @_user_1 from text
  for (const m of mentions) {
    if (m.key) {
      text = text.split(m.key).join('').trim();
    }
  }
  // Also strip common leftover patterns
  text = text.replace(/@_user_\d+/g, '').replace(/\s+/g, ' ').trim();

  return { text, mentionedBot, mentions };
}

/**
 * For p2p DMs, mention is not required — always treat as addressed to bot.
 */
export function isAddressedToBot(opts: {
  chatType: string;
  mentionedBot: boolean;
  requireMention: boolean;
}): boolean {
  if (opts.chatType === 'p2p') return true;
  if (!opts.requireMention) return true;
  return opts.mentionedBot;
}
