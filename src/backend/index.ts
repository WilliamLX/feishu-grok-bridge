import type { AppConfig } from '../config.js';
import type { GrokBackend } from './types.js';
import { EchoBackend } from './echo.js';
import { HttpBackend } from './http.js';
import { CursorAgentBackend } from './cursor-agent.js';

export type { GrokBackend, BackendRequest, BackendReply, BackendHistoryItem } from './types.js';
export { EchoBackend } from './echo.js';
export { HttpBackend, shapeHttpRequest, parseHttpResponse } from './http.js';
export { CursorAgentBackend } from './cursor-agent.js';

export function createBackend(cfg: AppConfig): GrokBackend {
  switch (cfg.grokBackend) {
    case 'echo':
      return new EchoBackend();
    case 'http':
      return new HttpBackend({
        url: cfg.grokBotWebhookUrl,
        token: cfg.grokBotWebhookToken || undefined,
        timeoutMs: cfg.grokHttpTimeoutMs,
      });
    case 'cursor-agent':
      return new CursorAgentBackend();
    default: {
      const _exhaustive: never = cfg.grokBackend;
      throw new Error(`Unknown GROK_BACKEND: ${_exhaustive}`);
    }
  }
}
