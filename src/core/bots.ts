import { existsSync, readFileSync } from 'node:fs';

export function loadBotCatalogFromPath(path: string): {
  catalog: BotCatalog;
  warning?: string;
} {
  if (!path.trim()) {
    return { catalog: new BotCatalog(), warning: 'BOT_CATALOG_PATH is empty' };
  }
  if (!existsSync(path)) {
    return {
      catalog: new BotCatalog(),
      warning: `catalog file not found: ${path}`,
    };
  }
  try {
    return { catalog: BotCatalog.fromFile(path) };
  } catch (e) {
    return {
      catalog: new BotCatalog(),
      warning: e instanceof Error ? e.message : String(e),
    };
  }
}

export type BotEntry = {
  id: string;
  name: string;
  description?: string;
  /** Default true when omitted. */
  enabled?: boolean;
};

export class UnknownAgentError extends Error {
  readonly agentId: string;

  constructor(agentId: string) {
    super(`Unknown or disabled agentId: ${agentId}`);
    this.name = 'UnknownAgentError';
    this.agentId = agentId;
  }
}

type CatalogFile = {
  bots?: BotEntry[];
};

function normalizeEntry(raw: BotEntry): BotEntry | null {
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id || !name) return null;
  return {
    id,
    name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    enabled: raw.enabled !== false,
  };
}

/**
 * In-memory Bot/Agent directory. Unknown/disabled ids never resolve — callers
 * must fail closed instead of falling back to a default bot.
 */
export class BotCatalog {
  private readonly byId = new Map<string, BotEntry>();

  constructor(entries: BotEntry[] = []) {
    for (const e of entries) {
      const n = normalizeEntry(e);
      if (!n) continue;
      this.byId.set(n.id, n);
    }
  }

  static fromEntries(entries: BotEntry[]): BotCatalog {
    return new BotCatalog(entries);
  }

  static fromJsonString(json: string): BotCatalog {
    const parsed = JSON.parse(json) as CatalogFile;
    const bots = Array.isArray(parsed.bots) ? parsed.bots : [];
    return new BotCatalog(bots);
  }

  static fromFile(path: string): BotCatalog {
    const raw = readFileSync(path, 'utf8');
    return BotCatalog.fromJsonString(raw);
  }

  /** Enabled bots only, stable insertion order. */
  listEnabled(): BotEntry[] {
    return [...this.byId.values()].filter((b) => b.enabled !== false);
  }

  listAll(): BotEntry[] {
    return [...this.byId.values()];
  }

  getEnabled(id: string): BotEntry | undefined {
    const key = id.trim();
    if (!key) return undefined;
    const bot = this.byId.get(key);
    if (!bot || bot.enabled === false) return undefined;
    return bot;
  }

  /** Fail-closed: never returns a fallback bot. */
  requireEnabled(id: string): BotEntry {
    const bot = this.getEnabled(id);
    if (!bot) throw new UnknownAgentError(id);
    return bot;
  }

  size(): number {
    return this.byId.size;
  }
}

export function userUnknownAgentMessage(agentId: string): string {
  const shown = agentId.trim() ? `\`${agentId.trim()}\`` : '(empty)';
  return `未知或已停用的 Bot：${shown}。发送 \`/bots\` 查看可用列表。不会使用默认 Bot。`;
}

export function userUnboundChatMessage(): string {
  return '还没有为当前会话选择 Bot。发送 `/bots` 查看列表，或使用 `/bot <id>` 选择后再对话。';
}

export function userEmptyCatalogMessage(): string {
  return 'Bot 目录为空。请管理员配置 `BOT_CATALOG_PATH`（见 bots.example.json）后重启 bridge。';
}
