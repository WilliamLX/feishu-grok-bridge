export type AclConfig = {
  /** open_id allowlist. Empty = deny ALL. */
  allowFrom: string[];
  /** chat_id allowlist. Empty = allow any chat (still gated by allowFrom). */
  allowChats: string[];
  /** In group chats, require @bot mention. */
  requireMention: boolean;
};

export type AclInput = {
  openId: string;
  chatId: string;
  chatType: 'p2p' | 'group' | string;
  mentionedBot: boolean;
};

export type AclDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Security policy:
 * - ALLOW_FROM empty → deny everyone (fail-closed).
 * - ALLOW_CHATS non-empty → chat must be listed.
 * - Groups with REQUIRE_MENTION → must @mention bot.
 */
export function checkAcl(cfg: AclConfig, input: AclInput): AclDecision {
  if (!cfg.allowFrom.length) {
    return {
      allowed: false,
      reason:
        'ALLOW_FROM is empty — all users denied. Set ALLOW_FROM to a comma-separated open_id allowlist.',
    };
  }

  if (!cfg.allowFrom.includes(input.openId)) {
    return { allowed: false, reason: `open_id not in ALLOW_FROM: ${input.openId}` };
  }

  if (cfg.allowChats.length > 0 && !cfg.allowChats.includes(input.chatId)) {
    return { allowed: false, reason: `chat_id not in ALLOW_CHATS: ${input.chatId}` };
  }

  const isGroup = input.chatType === 'group' || input.chatType === 'chat';
  if (isGroup && cfg.requireMention && !input.mentionedBot) {
    return { allowed: false, reason: 'group message without @bot mention (REQUIRE_MENTION=true)' };
  }

  return { allowed: true };
}
