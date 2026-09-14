export type HistoryMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
};

export type Session = {
  sessionId: string;
  chatId: string;
  createdAt: number;
  updatedAt: number;
  history: HistoryMessage[];
  stopped: boolean;
  meta: Record<string, string>;
};

export type SessionStoreOptions = {
  maxHistory?: number;
  /** Evict sessions idle longer than this (ms). Default 1h. */
  idleTtlMs?: number;
  /** Cap total in-memory sessions; evict oldest updatedAt first. Default 500. */
  maxSessions?: number;
};

export interface SessionStore {
  get(chatId: string): Session;
  reset(chatId: string): Session;
  append(chatId: string, msg: HistoryMessage): Session;
  setStopped(chatId: string, stopped: boolean): Session;
  list(): Session[];
  size(): number;
  evict(now?: number): number;
}

function newId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * In-memory sessions only. Process restart clears all state (sessions + any
 * related bridge memory). No Redis / durable store.
 */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly maxHistory: number;
  private readonly idleTtlMs: number;
  private readonly maxSessions: number;

  constructor(maxHistoryOrOpts: number | SessionStoreOptions = 20) {
    if (typeof maxHistoryOrOpts === 'number') {
      this.maxHistory = maxHistoryOrOpts;
      this.idleTtlMs = 3_600_000;
      this.maxSessions = 500;
    } else {
      this.maxHistory = maxHistoryOrOpts.maxHistory ?? 20;
      this.idleTtlMs = maxHistoryOrOpts.idleTtlMs ?? 3_600_000;
      this.maxSessions = maxHistoryOrOpts.maxSessions ?? 500;
    }
  }

  get(chatId: string): Session {
    this.evict();
    let s = this.sessions.get(chatId);
    if (!s) {
      s = this.create(chatId);
      this.sessions.set(chatId, s);
      this.enforceMax();
    }
    return s;
  }

  reset(chatId: string): Session {
    this.evict();
    const s = this.create(chatId);
    this.sessions.set(chatId, s);
    this.enforceMax();
    return s;
  }

  append(chatId: string, msg: HistoryMessage): Session {
    const s = this.get(chatId);
    s.history.push(msg);
    while (s.history.length > this.maxHistory) {
      s.history.shift();
    }
    s.updatedAt = Date.now();
    return s;
  }

  setStopped(chatId: string, stopped: boolean): Session {
    const s = this.get(chatId);
    s.stopped = stopped;
    s.updatedAt = Date.now();
    return s;
  }

  list(): Session[] {
    this.evict();
    return [...this.sessions.values()];
  }

  size(): number {
    return this.sessions.size;
  }

  /** Drop idle sessions; returns how many were removed. */
  evict(now = Date.now()): number {
    let removed = 0;
    for (const [chatId, s] of this.sessions) {
      if (now - s.updatedAt >= this.idleTtlMs) {
        this.sessions.delete(chatId);
        removed++;
      }
    }
    return removed;
  }

  private enforceMax(): void {
    if (this.sessions.size <= this.maxSessions) return;
    const ordered = [...this.sessions.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    const toDrop = this.sessions.size - this.maxSessions;
    for (let i = 0; i < toDrop; i++) {
      const key = ordered[i]?.[0];
      if (key) this.sessions.delete(key);
    }
  }

  private create(chatId: string): Session {
    const now = Date.now();
    return {
      sessionId: newId(),
      chatId,
      createdAt: now,
      updatedAt: now,
      history: [],
      stopped: false,
      meta: {},
    };
  }
}
