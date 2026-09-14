export type AclConfig = {
  /** open_id allowlist. Empty = deny ALL (except runtime bootstrap path). */
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
 * - ALLOW_FROM empty → deny everyone (fail-closed). Bootstrap `/whoami` is
 *   handled separately in BridgeCore before this check.
 * - ALLOW_CHATS non-empty → chat must be listed.
 * - Groups with REQUIRE_MENTION → must @mention bot.
 */
export function checkAcl(cfg: AclConfig, input: AclInput): AclDecision {
  if (!cfg.allowFrom.length) {
    return {
      allowed: false,
      reason:
        'ALLOW_FROM is empty — all users denied. DM /whoami to bootstrap, then set ALLOW_FROM.',
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

/** User-facing ACL denial — short, non-leaky (no allowlist contents / ids). */
export function aclDenyUserMessage(reason: string): string | null {
  // Stay silent for "not mentioned" — normal group chatter.
  if (reason.includes('without @bot mention')) return null;

  if (reason.includes('ALLOW_FROM is empty')) {
    return '⛔ Bridge is in bootstrap mode (ALLOW_FROM empty). DM `/whoami`, then set ALLOW_FROM and restart.';
  }
  if (reason.includes('not in ALLOW_FROM')) {
    return '⛔ Not authorized. Ask an admin to add your open_id to ALLOW_FROM (DM `/whoami` to see it).';
  }
  if (reason.includes('not in ALLOW_CHATS')) {
    return '⛔ This chat is not on the allowlist (ALLOW_CHATS).';
  }
  return '⛔ Not authorized.';
}
