export type CommandName = 'help' | 'new' | 'status' | 'whoami' | 'stop' | 'bots' | 'bot';

export type ParsedCommand =
  | { type: 'command'; name: CommandName; args: string }
  | { type: 'message'; text: string };

const COMMANDS: CommandName[] = ['help', 'new', 'status', 'whoami', 'stop', 'bots', 'bot'];

/**
 * Parse leading /command from user text (after mention stripping).
 */
export function parseCommand(raw: string): ParsedCommand {
  const text = raw.trim();
  const m = text.match(/^\/([a-zA-Z_]+)(?:\s+(.*))?$/s);
  if (!m) return { type: 'message', text };

  const name = m[1]!.toLowerCase() as CommandName;
  if (!COMMANDS.includes(name)) {
    return { type: 'message', text };
  }
  return { type: 'command', name, args: (m[2] ?? '').trim() };
}

export function helpText(): string {
  return [
    '**Grok Bridge 命令**',
    '',
    '`/help` — 显示帮助',
    '`/new` — 开启新会话（清空历史）',
    '`/status` — 当前会话状态',
    '`/whoami` — 显示你的 open_id / chat_id',
    '`/stop` — 暂停本会话自动回复（`/new` 恢复）',
    '`/bots` — 列出并选择 Bot',
    '`/bot <id>` — 绑定当前会话到指定 Bot（切换会清空历史）',
    '',
    '直接发消息即可与已绑定的 Bot 多轮对话。',
  ].join('\n');
}

export function isKnownCommand(name: string): name is CommandName {
  return COMMANDS.includes(name as CommandName);
}

export { COMMANDS };
