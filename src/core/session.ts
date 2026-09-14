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

export interface SessionStore {
  get(chatId: string): Session;
  reset(chatId: string): Session;
  append(chatId: string, msg: HistoryMessage): Session;
  setStopped(chatId: string, stopped: boolean): Session;
  list(): Session[];
}

function newId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly maxHistory: number;

  constructor(maxHistory = 20) {
    this.maxHistory = maxHistory;
  }

  get(chatId: string): Session {
    let s = this.sessions.get(chatId);
    if (!s) {
      s = this.create(chatId);
      this.sessions.set(chatId, s);
    }
    return s;
  }

  reset(chatId: string): Session {
    const s = this.create(chatId);
    this.sessions.set(chatId, s);
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
    return [...this.sessions.values()];
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
