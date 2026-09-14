import type { BackendRequest, BackendReply, GrokBackend } from './types.js';
import { log } from '../logger.js';

export type HttpBackendOptions = {
  url: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Shape the JSON body posted to GROK_BOT_WEBHOOK_URL.
 * Exported for unit tests.
 */
export function shapeHttpRequest(req: BackendRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    sessionId: req.sessionId,
    chatId: req.chatId,
    userId: req.userId,
    text: req.text,
  };
  if (req.history && req.history.length > 0) {
    body.history = req.history;
  }
  return body;
}

/**
 * Parse JSON `{ reply }` or SSE `data: {"reply":"..."}` streams.
 * Exported for unit tests.
 */
export async function parseHttpResponse(res: Response): Promise<BackendReply> {
  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
    const text = await res.text();
    return parseSseOrPlain(text);
  }

  const text = await res.text();
  if (!text.trim()) {
    throw new Error('HttpBackend: empty response body');
  }

  // Try JSON first
  try {
    const json = JSON.parse(text) as { reply?: unknown; message?: unknown };
    const reply = pickReply(json);
    if (reply !== undefined) return { reply };
  } catch {
    // fall through to SSE/plain
  }

  return parseSseOrPlain(text);
}

function pickReply(json: { reply?: unknown; message?: unknown }): string | undefined {
  if (typeof json.reply === 'string') return json.reply;
  if (typeof json.message === 'string') return json.message;
  return undefined;
}

function parseSseOrPlain(raw: string): BackendReply {
  const lines = raw.split(/\r?\n/);
  let lastReply: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    if (trimmed.startsWith('data:')) {
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as {
          reply?: unknown;
          message?: unknown;
          delta?: unknown;
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const r = pickReply(json);
        if (r !== undefined) lastReply = r;
        else if (typeof json.delta === 'string') {
          lastReply = (lastReply ?? '') + json.delta;
        } else if (json.choices?.[0]?.delta?.content) {
          lastReply = (lastReply ?? '') + json.choices[0].delta.content;
        }
      } catch {
        // treat as raw data text
        lastReply = (lastReply ?? '') + payload;
      }
    }
  }

  if (lastReply !== undefined) return { reply: lastReply };

  // Plain text fallback
  if (raw.trim()) return { reply: raw.trim() };
  throw new Error('HttpBackend: could not parse reply from response');
}

export class HttpBackend implements GrokBackend {
  readonly name = 'http';
  private readonly url: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpBackendOptions) {
    if (!opts.url) throw new Error('HttpBackend: url is required');
    this.url = opts.url;
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async handle(req: BackendRequest): Promise<BackendReply> {
    const body = shapeHttpRequest(req);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream, text/plain',
    };
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);

    try {
      log.debug('HttpBackend POST', { url: this.url, sessionId: req.sessionId });
      const res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(
          `HttpBackend: HTTP ${res.status} ${res.statusText}${errBody ? ` — ${errBody.slice(0, 200)}` : ''}`,
        );
      }

      return await parseHttpResponse(res);
    } finally {
      clearTimeout(timer);
    }
  }
}
