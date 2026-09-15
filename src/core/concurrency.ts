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
    const tail = next.catch(() => undefined);
    this.tails.set(chatId, tail);

    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(chatId) === tail) {
        this.tails.delete(chatId);
      }
    }
  }

  pendingCount(): number {
    return this.tails.size;
  }
}
