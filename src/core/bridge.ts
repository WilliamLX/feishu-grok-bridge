import type * as lark from '@larksuiteoapi/node-sdk';
import type { AppConfig } from '../config.js';
import type { GrokBackend } from '../backend/types.js';
import { MemorySessionStore } from './session.js';
import { checkAcl, aclDenyUserMessage } from './acl.js';
import { DedupeStore } from './dedupe.js';
import { ChatConcurrency } from './concurrency.js';
import { parseCommand, helpText } from './commands.js';
import {
  BotCatalog,
  UnknownAgentError,
  userEmptyCatalogMessage,
  userUnboundChatMessage,
  userUnknownAgentMessage,
} from './bots.js';
import { MemoryBindingStore, type BindingStore } from './binding.js';
import { parseMentions } from '../feishu/mention.js';
import { replyPreferCard, buildReplyCard, replyText, sendTextToChat } from '../feishu/message.js';
import { buildBotPickerCard, SELECT_BOT_ACTION, type IncomingCardAction } from '../feishu/card.js';
import type { IncomingMessage } from '../feishu/ws.js';
import { log } from '../logger.js';

export type BridgeDeps = {
  cfg: AppConfig;
  client: lark.Client;
  backend: GrokBackend;
  botOpenId?: string;
  catalog?: BotCatalog;
  bindings?: BindingStore;
};

/** Safe user-facing backend failure — details stay in server logs only. */
export function sanitizeBackendErrorForUser(err: unknown): string {
  if (err instanceof UnknownAgentError) {
    return userUnknownAgentMessage(err.agentId);
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/agentId is required|unknown agent|invalid agent|no default bot/i.test(msg)) {
    return '该 Bot 不可用或已失效。发送 `/bots` 重新选择。不会使用默认 Bot。';
  }
  return '⚠️ Something went wrong talking to the backend. Please try again later.';
}

/** Immediate Feishu ack before awaiting HttpBackend / outbox. */
export const PROCESSING_ACK_TEXT = '收到，正在处理中';

type Addressable = {
  chatId: string;
  messageId: string;
  chatType: string;
  openId: string;
};

export class BridgeCore {
  private readonly cfg: AppConfig;
  private readonly client: lark.Client;
  private readonly backend: GrokBackend;
  private readonly sessions: MemorySessionStore;
  private readonly dedupe: DedupeStore;
  private readonly concurrency: ChatConcurrency;
  private readonly catalog: BotCatalog;
  private readonly bindings: BindingStore;
  private botOpenId?: string;
  private startedAt = Date.now();

  constructor(deps: BridgeDeps) {
    this.cfg = deps.cfg;
    this.client = deps.client;
    this.backend = deps.backend;
    this.botOpenId = deps.botOpenId;
    this.catalog = deps.catalog ?? new BotCatalog();
    this.bindings = deps.bindings ?? new MemoryBindingStore();
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
    const enabled = this.catalog.listEnabled();
    return {
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      backend: this.backend.name,
      sessions: this.sessions.list().length,
      dedupeSize: this.dedupe.size(),
      pendingChats: this.concurrency.pendingCount(),
      allowFromCount: this.cfg.allowFrom.length,
      allowChatsCount: this.cfg.allowChats.length,
      botOpenIdKnown: Boolean(this.botOpenId),
      catalogSize: enabled.length,
      bindingsSize: this.bindings.size(),
    };
  }

  async handleIncoming(msg: IncomingMessage): Promise<void> {
    if (!this.dedupe.tryClaim(msg.eventId)) {
      log.debug('duplicate event skipped', { eventId: msg.eventId });
      return;
    }

    this.abortInFlightIfBotSwitch(msg);

    await this.concurrency.run(msg.chatId, () => this.process(msg));
  }

  async handleCardAction(action: IncomingCardAction): Promise<void> {
    if (!this.dedupe.tryClaim(action.eventId)) {
      log.debug('duplicate card action skipped', { eventId: action.eventId });
      return;
    }

    const addressed: Addressable = {
      chatId: action.chatId,
      messageId: action.messageId,
      chatType: action.chatType || 'p2p',
      openId: action.openId,
    };

    const acl = checkAcl(
      {
        allowFrom: this.cfg.allowFrom,
        allowChats: this.cfg.allowChats,
        requireMention: this.cfg.requireMention,
      },
      {
        openId: action.openId,
        chatId: action.chatId,
        chatType: addressed.chatType,
        mentionedBot: true,
      },
    );

    if (!acl.allowed) {
      log.info('ACL denied card action', { reason: acl.reason, openId: action.openId });
      const userMsg = aclDenyUserMessage(acl.reason);
      if (userMsg) await this.reply(addressed, userMsg, 'Access');
      return;
    }

    if (action.action !== SELECT_BOT_ACTION || !action.agentId) {
      await this.reply(addressed, '无法识别的卡片操作。请发送 `/bots`。', 'Bot');
      return;
    }

    const bot = this.catalog.getEnabled(action.agentId);
    if (bot) {
      this.bindings.bind(action.chatId, bot.id);
      this.sessions.reset(action.chatId);
    }

    await this.concurrency.run(action.chatId, () =>
      this.applyBotSelection(addressed, action.agentId ?? ''),
    );
  }

  /**
   * Valid `/bot <id>` must bump epoch immediately so an in-flight turn on the
   * same chat cannot later post the old agent's reply.
   */
  private abortInFlightIfBotSwitch(msg: IncomingMessage): void {
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
    let mentionedBot = mentionInfo.mentionedBot;
    if (msg.chatType === 'p2p') mentionedBot = true;

    const text = mentionInfo.text.trim();
    const parsed = text ? parseCommand(text) : null;
    if (parsed?.type !== 'command' || parsed.name !== 'bot') return;
    const agentId = parsed.args.trim();
    if (!agentId) return;

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
    if (!acl.allowed) return;

    const bot = this.catalog.getEnabled(agentId);
    if (!bot) return;

    this.bindings.bind(msg.chatId, bot.id);
    this.sessions.reset(msg.chatId);
    log.info('bot switch abort in-flight', { chatId: msg.chatId, agentId: bot.id });
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

    const isWhoami =
      parsed?.type === 'command' && parsed.name === 'whoami';
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

    const bound = this.resolveBoundAgent(msg.chatId);
    if (!bound.ok) {
      await this.reply(msg, bound.message, 'Bot');
      return;
    }

    this.sessions.append(msg.chatId, {
      role: 'user',
      content: parsed.text,
      ts: Date.now(),
    });

    const fresh = this.sessions.get(msg.chatId);
    const epoch = this.bindings.epoch(msg.chatId);

    await this.replyProcessingAck(msg);

    try {
      const result = await this.backend.handle({
        sessionId: fresh.sessionId,
        chatId: msg.chatId,
        userId: msg.openId,
        agentId: bound.agentId,
        text: parsed.text,
        history: fresh.history.map((h) => ({ role: h.role, content: h.content })),
      });

      if (this.bindings.epoch(msg.chatId) !== epoch) {
        log.info('dropped stale backend reply after bot switch', {
          chatId: msg.chatId,
          agentId: bound.agentId,
        });
        return;
      }

      this.sessions.append(msg.chatId, {
        role: 'assistant',
        content: result.reply,
        ts: Date.now(),
      });

      await this.reply(msg, result.reply, 'Grok', result.card);
    } catch (e) {
      if (this.bindings.epoch(msg.chatId) !== epoch) {
        log.info('dropped stale backend error after bot switch', { chatId: msg.chatId });
        return;
      }
      const err = e instanceof Error ? e.message : String(e);
      log.error('backend error', { error: err });
      await this.reply(msg, sanitizeBackendErrorForUser(e), 'Error');
    }
  }

  private resolveBoundAgent(
    chatId: string,
  ): { ok: true; agentId: string } | { ok: false; message: string } {
    const enabled = this.catalog.listEnabled();
    if (enabled.length === 0) {
      return { ok: false, message: userEmptyCatalogMessage() };
    }
    const rec = this.bindings.get(chatId);
    if (!rec?.agentId) {
      return { ok: false, message: userUnboundChatMessage() };
    }
    const bot = this.catalog.getEnabled(rec.agentId);
    if (!bot) {
      return { ok: false, message: userUnknownAgentMessage(rec.agentId) };
    }
    return { ok: true, agentId: bot.id };
  }

  private async handleCommand(
    msg: IncomingMessage,
    name: string,
    args: string,
  ): Promise<void> {
    switch (name) {
      case 'help':
        await this.reply(msg, helpText(), 'Help');
        return;
      case 'new': {
        const s = this.sessions.reset(msg.chatId);
        const bound = this.bindings.get(msg.chatId);
        const bot = bound ? this.catalog.getEnabled(bound.agentId) : undefined;
        const bindLine = bot
          ? `\nBot: **${bot.name}** (\`${bot.id}\`)（绑定未改）`
          : '\n尚未绑定 Bot，发送 `/bots` 选择。';
        await this.reply(
          msg,
          `✨ 新会话已创建\nsession: \`${s.sessionId}\`${bindLine}`,
          'New Session',
        );
        return;
      }
      case 'status': {
        const s = this.sessions.get(msg.chatId);
        const st = this.getStatus();
        const bound = this.bindings.get(msg.chatId);
        const bot = bound ? this.catalog.getEnabled(bound.agentId) : undefined;
        const botLine = bot
          ? `bot: **${bot.name}** (\`${bot.id}\`)`
          : bound
            ? `bot: 绑定 \`${bound.agentId}\`（目录中无效）`
            : 'bot: （未绑定）';
        const body = [
          `**Bridge status**`,
          `backend: \`${st.backend}\``,
          `uptime: ${st.uptimeSec}s`,
          `sessions: ${st.sessions}`,
          `pending chats: ${st.pendingChats}`,
          `bot open_id known: ${st.botOpenIdKnown}`,
          `catalog: ${st.catalogSize} enabled`,
          '',
          `**This chat**`,
          `session: \`${s.sessionId}\``,
          `history: ${s.history.length}`,
          `stopped: ${s.stopped}`,
          botLine,
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
      case 'bots': {
        await this.replyBotList(msg);
        return;
      }
      case 'bot': {
        const id = args.trim();
        if (!id) {
          await this.replyBotList(msg);
          return;
        }
        await this.applyBotSelection(msg, id);
        return;
      }
      default:
        await this.reply(msg, helpText(), 'Help');
    }
  }

  private async replyBotList(msg: Addressable): Promise<void> {
    const bots = this.catalog.listEnabled();
    if (bots.length === 0) {
      await this.reply(msg, userEmptyCatalogMessage(), 'Bots');
      return;
    }
    const current = this.bindings.get(msg.chatId)?.agentId;
    const text = bots
      .map((b) => {
        const mark = b.id === current ? ' ← 当前' : '';
        const desc = b.description ? ` — ${b.description}` : '';
        return `• **${b.name}** (\`${b.id}\`)${desc}${mark}`;
      })
      .join('\n');
    await this.reply(
      msg,
      `${text}\n\n发送 \`/bot <id>\` 绑定。切换会清空本会话历史。`,
      'Bots',
      buildBotPickerCard(bots, current),
    );
  }

  private async applyBotSelection(msg: Addressable, agentId: string): Promise<void> {
    const bot = this.catalog.getEnabled(agentId);
    if (!bot) {
      log.warn('reject unknown agentId (no default fallback)', { agentId, chatId: msg.chatId });
      await this.reply(msg, userUnknownAgentMessage(agentId), 'Bot');
      return;
    }
    this.bindings.bind(msg.chatId, bot.id);
    this.sessions.reset(msg.chatId);
    await this.reply(
      msg,
      `已绑定 **${bot.name}** (\`${bot.id}\`)。\n新会话已开始；之后的消息都会发给该 Bot。切换 Bot 会清空历史。`,
      'Bot',
    );
  }

  /** Lightweight text ack — not a card — so the user sees progress immediately. */
  private async replyProcessingAck(msg: IncomingMessage): Promise<void> {
    const res = await replyText(this.client, {
      messageId: msg.messageId,
      text: PROCESSING_ACK_TEXT,
    });
    if (!res.ok) {
      log.warn('processing ack failed', { error: res.error, messageId: msg.messageId });
    }
  }

  private async reply(
    msg: Addressable,
    text: string,
    title?: string,
    card?: Record<string, unknown>,
  ): Promise<void> {
    if (!msg.messageId) {
      const res = await sendTextToChat(this.client, { chatId: msg.chatId, text });
      if (!res.ok) log.error('failed to send to chat', { error: res.error });
      return;
    }
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
