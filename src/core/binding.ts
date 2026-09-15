import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { log } from '../logger.js';

export type ChatBinding = {
  agentId: string;
  updatedAt: number;
};

export interface BindingStore {
  get(chatId: string): ChatBinding | undefined;
  /** Persist chat→agent and bump in-memory epoch (invalidates in-flight turns). */
  bind(chatId: string, agentId: string): ChatBinding;
  /** Bump epoch without changing the stored agentId (abort in-flight). */
  bumpEpoch(chatId: string): number;
  epoch(chatId: string): number;
  size(): number;
}

type FileShape = {
  version: 1;
  bindings: Record<string, ChatBinding>;
};

/**
 * JSON-file persistence for chat_id → agent_id.
 * Epoch is process-local (in-flight cancellation); restart has no in-flight turns.
 */
export class FileBindingStore implements BindingStore {
  private readonly filePath: string;
  private bindings = new Map<string, ChatBinding>();
  private readonly epochs = new Map<string, number>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  get(chatId: string): ChatBinding | undefined {
    return this.bindings.get(chatId);
  }

  bind(chatId: string, agentId: string): ChatBinding {
    const rec: ChatBinding = { agentId, updatedAt: Date.now() };
    this.bindings.set(chatId, rec);
    this.bumpEpoch(chatId);
    this.flush();
    return rec;
  }

  bumpEpoch(chatId: string): number {
    const n = this.epoch(chatId) + 1;
    this.epochs.set(chatId, n);
    return n;
  }

  epoch(chatId: string): number {
    return this.epochs.get(chatId) ?? 0;
  }

  size(): number {
    return this.bindings.size;
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.bindings = new Map();
      return;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as FileShape;
      const recs = parsed?.bindings && typeof parsed.bindings === 'object' ? parsed.bindings : {};
      this.bindings = new Map(
        Object.entries(recs).filter(
          ([k, v]) => Boolean(k) && v && typeof v.agentId === 'string' && v.agentId.trim(),
        ),
      );
    } catch (e) {
      log.warn('binding store load failed — starting empty', {
        path: this.filePath,
        error: e instanceof Error ? e.message : String(e),
      });
      this.bindings = new Map();
    }
  }

  private flush(): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const body: FileShape = {
      version: 1,
      bindings: Object.fromEntries(this.bindings),
    };
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.filePath);
  }
}

/** In-memory store for tests (no disk). */
export class MemoryBindingStore implements BindingStore {
  private readonly bindings = new Map<string, ChatBinding>();
  private readonly epochs = new Map<string, number>();

  get(chatId: string): ChatBinding | undefined {
    return this.bindings.get(chatId);
  }

  bind(chatId: string, agentId: string): ChatBinding {
    const rec: ChatBinding = { agentId, updatedAt: Date.now() };
    this.bindings.set(chatId, rec);
    this.bumpEpoch(chatId);
    return rec;
  }

  bumpEpoch(chatId: string): number {
    const n = this.epoch(chatId) + 1;
    this.epochs.set(chatId, n);
    return n;
  }

  epoch(chatId: string): number {
    return this.epochs.get(chatId) ?? 0;
  }

  size(): number {
    return this.bindings.size;
  }
}
