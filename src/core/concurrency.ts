/**
 * Per-key serial queue: at most one job runs per chat_id at a time.
 */
export class ChatConcurrency {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(chatId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const next = prev.then(() => gate);
    this.tails.set(chatId, next.catch(() => undefined));

    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(chatId) === next) {
        this.tails.delete(chatId);
      }
    }
  }

  pendingCount(): number {
    return this.tails.size;
  }
}
