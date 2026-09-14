import type * as lark from '@larksuiteoapi/node-sdk';
import type { AppConfig } from '../config.js';
import type { GrokBackend } from '../backend/types.js';
import { MemorySessionStore } from './session.js';
import { checkAcl, aclDenyUserMessage } from './acl.js';
import { DedupeStore } from './dedupe.js';
import { ChatConcurrency } from './concurrency.js';
import { parseCommand, helpText } from './commands.js';
import { parseMentions } from '../feishu/mention.js';
import { replyPreferCard, buildReplyCard } from '../feishu/message.js';
import type { IncomingMessage } from '../feishu/ws.js';
import { log } from '../logger.js';

export type BridgeDeps = {
  cfg: AppConfig;
  client: lark.Client;
  backend: GrokBackend;
  botOpenId?: string;
};

/** Safe user-facing backend failure — details stay in server logs only. */
export function sanitizeBackendErrorForUser(_err: unknown): string {
  return '⚠️ Something went wrong talking to the backend. Please try again later.';
}

export class BridgeCore {
  private readonly cfg: AppConfig;
  private readonly client: lark.Client;
  private readonly backend: GrokBackend;
  private readonly sessions: MemorySessionStore;
  private readonly dedupe: DedupeStore;
  private readonly concurrency: ChatConcurrency;
  private botOpenId?: string;
  private startedAt = Date.now();

  constructor(deps: BridgeDeps) {
    this.cfg = deps.cfg;
    this.client = deps.client;
    this.backend = deps.backend;
    this.botOpenId = deps.botOpenId;
    this.sessions = new MemorySessionStore({
      maxHistory: deps.cfg.sessionMaxHistory,
      idleTtlMs: deps.cfg.sessionIdleTtlMs,
      maxSessions: deps.cfg.sessionMaxCount,
    });
    this.dedupe = new DedupeStore(deps.cfg.dedupeTtlMs);
    this.concurrency = new ChatConcurrency();
  }

  setBotOpenId(id: string): void {
    this.botOpenId = id;
  }

  getStatus() {
    return {
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      backend: this.backend.name,
      sessions: this.sessions.list().length,
      dedupeSize: this.dedupe.size(),
      pendingChats: this.concurrency.pendingCount(),
      allowFromCount: this.cfg.allowFrom.length,
      allowChatsCount: this.cfg.allowChats.length,
      botOpenIdKnown: Boolean(this.botOpenId),
    };
  }

  async handleIncoming(msg: IncomingMessage): Promise<void> {
    if (!this.dedupe.tryClaim(msg.eventId)) {
      log.debug('duplicate event skipped', { eventId: msg.eventId });
      return;
    }

    await this.concurrency.run(msg.chatId, () => this.process(msg));
  }

  private async process(msg: IncomingMessage): Promise<void> {
    const mentionInfo = parseMentions(
      {
        message: {
          content: msg.contentRaw,
          mentions: msg.mentions,
          chat_type: msg.chatType,
        },
      },
      this.botOpenId,
    );

    // Exact bot open_id match only. When botOpenId is unknown, do NOT treat
    // arbitrary @mentions as addressing us (avoids REQUIRE_MENTION false positives).
    let mentionedBot = mentionInfo.mentionedBot;
    if (msg.chatType === 'p2p') {
      mentionedBot = true;
    }
    if (
      msg.chatType !== 'p2p' &&
      this.cfg.requireMention &&
      !this.botOpenId &&
      !mentionedBot
    ) {
      log.warn('REQUIRE_MENTION=true but botOpenId unknown — ignoring group msg', {
        chatId: msg.chatId,
      });
    }

    const text = mentionInfo.text.trim();
    const parsed = text ? parseCommand(text) : null;

    // Bootstrap: empty ALLOW_FROM still permits /whoami (prefer DM) so operators
    // can discover their open_id without a chicken-egg lockout.
    const isWhoami =
      parsed?.type === 'command' && parsed.name === 'whoami';
    // DM-only: do not let group /whoami bypass ALLOW_CHATS / REQUIRE_MENTION.
    const bootstrapWhoami =
      this.cfg.allowFrom.length === 0 &&
      isWhoami &&
      Boolean(text) &&
      msg.chatType === 'p2p';

    if (bootstrapWhoami) {
      log.info('bootstrap /whoami allowed (ALLOW_FROM empty)', {
        openId: msg.openId,
        chatType: msg.chatType,
      });
      await this.handleCommand(msg, 'whoami', '');
      return;
    }

    const acl = checkAcl(
      {
        allowFrom: this.cfg.allowFrom,
        allowChats: this.cfg.allowChats,
        requireMention: this.cfg.requireMention,
      },
      {
        openId: msg.openId,
        chatId: msg.chatId,
        chatType: msg.chatType,
        mentionedBot,
      },
    );

    if (!acl.allowed) {
      log.info('ACL denied', { reason: acl.reason, openId: msg.openId, chatId: msg.chatId });
      const userMsg = aclDenyUserMessage(acl.reason);
      // Only reply when we would have been addressed (DM or @bot), to avoid group spam
      if (userMsg && (msg.chatType === 'p2p' || mentionedBot)) {
        await this.reply(msg, userMsg, 'Access');
      }
      return;
    }

    if (!text || !parsed) {
      log.debug('empty text after mention strip');
      return;
    }

    if (parsed.type === 'command') {
      await this.handleCommand(msg, parsed.name, parsed.args);
      return;
    }

    const session = this.sessions.get(msg.chatId);
    if (session.stopped) {
      await this.reply(
        msg,
        '会话已暂停。发送 `/new` 重新开始，或 `/help` 查看命令。',
        'Paused',
      );
      return;
    }

    this.sessions.append(msg.chatId, {
      role: 'user',
      content: parsed.text,
      ts: Date.now(),
    });

    const fresh = this.sessions.get(msg.chatId);
    try {
      const result = await this.backend.handle({
        sessionId: fresh.sessionId,
        chatId: msg.chatId,
        userId: msg.openId,
        text: parsed.text,
        history: fresh.history.map((h) => ({ role: h.role, content: h.content })),
      });

      this.sessions.append(msg.chatId, {
        role: 'assistant',
        content: result.reply,
        ts: Date.now(),
      });

      await this.reply(msg, result.reply, 'Grok', result.card);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log.error('backend error', { error: err });
      await this.reply(msg, sanitizeBackendErrorForUser(e), 'Error');
    }
  }

  private async handleCommand(
    msg: IncomingMessage,
    name: string,
    _args: string,
  ): Promise<void> {
    switch (name) {
      case 'help':
        await this.reply(msg, helpText(), 'Help');
        return;
      case 'new': {
        const s = this.sessions.reset(msg.chatId);
        await this.reply(
          msg,
          `✨ 新会话已创建\nsession: \`${s.sessionId}\``,
          'New Session',
        );
        return;
      }
      case 'status': {
        const s = this.sessions.get(msg.chatId);
        const st = this.getStatus();
        const body = [
          `**Bridge status**`,
          `backend: \`${st.backend}\``,
          `uptime: ${st.uptimeSec}s`,
          `sessions: ${st.sessions}`,
          `pending chats: ${st.pendingChats}`,
          `bot open_id known: ${st.botOpenIdKnown}`,
          '',
          `**This chat**`,
          `session: \`${s.sessionId}\``,
          `history: ${s.history.length}`,
          `stopped: ${s.stopped}`,
        ].join('\n');
        await this.reply(msg, body, 'Status');
        return;
      }
      case 'whoami': {
        const bootstrapHint =
          this.cfg.allowFrom.length === 0
            ? '\n\n**Bootstrap:** 将 `open_id` 写入 `.env` 的 `ALLOW_FROM` 后重启 bridge。'
            : '\n\n将 `open_id` 加入 `ALLOW_FROM`，可选将 `chat_id` 加入 `ALLOW_CHATS`。';
        const body = [
          `open_id: \`${msg.openId}\``,
          `chat_id: \`${msg.chatId}\``,
          `chat_type: \`${msg.chatType}\``,
          bootstrapHint,
        ].join('\n');
        await this.reply(msg, body, 'Who Am I');
        return;
      }
      case 'stop': {
        this.sessions.setStopped(msg.chatId, true);
        await this.reply(msg, '⏹ 已暂停本会话。发送 `/new` 恢复。', 'Stopped');
        return;
      }
      default:
        await this.reply(msg, helpText(), 'Help');
    }
  }

  private async reply(
    msg: IncomingMessage,
    text: string,
    title?: string,
    card?: Record<string, unknown>,
  ): Promise<void> {
    const res = await replyPreferCard(this.client, {
      messageId: msg.messageId,
      text,
      title,
      card: card ?? buildReplyCard(title ?? 'Grok', text),
    });
    if (!res.ok) {
      log.error('failed to reply', { error: res.error });
    }
  }
}
