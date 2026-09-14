import type * as lark from '@larksuiteoapi/node-sdk';
import type { AppConfig } from '../config.js';
import type { GrokBackend } from '../backend/types.js';
import { MemorySessionStore } from './session.js';
import { checkAcl } from './acl.js';
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
    this.sessions = new MemorySessionStore(deps.cfg.sessionMaxHistory);
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

    // For groups without explicit bot open_id match, if mentions array is
    // non-empty and text was stripped, treat as mentioned when botOpenId unknown
    let mentionedBot = mentionInfo.mentionedBot;
    if (
      !mentionedBot &&
      !this.botOpenId &&
      msg.chatType !== 'p2p' &&
      msg.mentions.length > 0
    ) {
      // Conservative: any @mention in group counts when we can't resolve bot id
      mentionedBot = true;
    }
    if (msg.chatType === 'p2p') {
      mentionedBot = true;
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
      return;
    }

    const text = mentionInfo.text.trim();
    if (!text) {
      log.debug('empty text after mention strip');
      return;
    }

    const parsed = parseCommand(text);
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
      await this.reply(msg, `⚠️ Backend error: ${err}`, 'Error');
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
        const body = [
          `open_id: \`${msg.openId}\``,
          `chat_id: \`${msg.chatId}\``,
          `chat_type: \`${msg.chatType}\``,
          '',
          '将 `open_id` 加入 `ALLOW_FROM`，可选将 `chat_id` 加入 `ALLOW_CHATS`。',
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
