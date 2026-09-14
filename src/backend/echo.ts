import type { BackendRequest, BackendReply, GrokBackend } from './types.js';

/** Smoke-test backend: echoes user text with session metadata. */
export class EchoBackend implements GrokBackend {
  readonly name = 'echo';

  async handle(req: BackendRequest): Promise<BackendReply> {
    const histLen = req.history?.length ?? 0;
    return {
      reply: [
        `🔁 EchoBackend`,
        ``,
        `session: \`${req.sessionId}\``,
        `chat: \`${req.chatId}\``,
        `user: \`${req.userId}\``,
        `history: ${histLen} turns`,
        ``,
        `> ${req.text}`,
      ].join('\n'),
    };
  }
}
