import { describe, it, expect, vi } from 'vitest';
import {
  shapeHttpRequest,
  parseHttpResponse,
  HttpBackend,
} from '../src/backend/http.js';
import type { BackendRequest } from '../src/backend/types.js';

const sampleReq: BackendRequest = {
  sessionId: 'sess_1',
  chatId: 'oc_chat',
  userId: 'ou_user',
  agentId: 'grok-main',
  text: 'hello',
  history: [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hey' },
  ],
};

describe('shapeHttpRequest', () => {
  it('shapes expected JSON body', () => {
    expect(shapeHttpRequest(sampleReq)).toEqual({
      sessionId: 'sess_1',
      chatId: 'oc_chat',
      userId: 'ou_user',
      agentId: 'grok-main',
      text: 'hello',
      history: sampleReq.history,
    });
  });

  it('omits empty history', () => {
    const body = shapeHttpRequest({ ...sampleReq, history: [] });
    expect(body).not.toHaveProperty('history');
    expect(body.agentId).toBe('grok-main');
  });

  it('does not invent a default agentId', () => {
    const { agentId: _drop, ...rest } = sampleReq;
    void _drop;
    const body = shapeHttpRequest({ ...rest, history: [] });
    expect(body).not.toHaveProperty('agentId');
  });
});

describe('parseHttpResponse', () => {
  it('parses JSON { reply }', async () => {
    const res = new Response(JSON.stringify({ reply: 'pong' }), {
      headers: { 'content-type': 'application/json' },
    });
    await expect(parseHttpResponse(res)).resolves.toEqual({ reply: 'pong' });
  });

  it('parses SSE data lines', async () => {
    const sse = [
      'data: {"delta":"Hel"}',
      'data: {"delta":"lo"}',
      'data: [DONE]',
      '',
    ].join('\n');
    const res = new Response(sse, {
      headers: { 'content-type': 'text/event-stream' },
    });
    await expect(parseHttpResponse(res)).resolves.toEqual({ reply: 'Hello' });
  });

  it('parses SSE with final reply object', async () => {
    const sse = 'data: {"reply":"final answer"}\n\n';
    const res = new Response(sse, {
      headers: { 'content-type': 'text/event-stream' },
    });
    await expect(parseHttpResponse(res)).resolves.toEqual({ reply: 'final answer' });
  });

  it('falls back to plain text', async () => {
    const res = new Response('just text', {
      headers: { 'content-type': 'text/plain' },
    });
    await expect(parseHttpResponse(res)).resolves.toEqual({ reply: 'just text' });
  });
});

describe('HttpBackend.handle', () => {
  it('POSTs shaped body and returns reply', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.sessionId).toBe('sess_1');
      expect(body.text).toBe('hello');
      expect(body.agentId).toBe('grok-main');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
      return new Response(JSON.stringify({ reply: 'from-http' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const backend = new HttpBackend({
      url: 'http://example.test/turn',
      token: 'tok',
      fetchImpl,
    });
    const out = await backend.handle(sampleReq);
    expect(out.reply).toBe('from-http');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('refuses to POST without agentId (no default bot)', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const backend = new HttpBackend({ url: 'http://example.test/turn', fetchImpl });
    const { agentId: _a, ...rest } = sampleReq;
    void _a;
    await expect(backend.handle(rest)).rejects.toThrow(/agentId is required/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws on non-OK HTTP', async () => {
    const fetchImpl = (async () =>
      new Response('nope', { status: 500, statusText: 'ERR' })) as unknown as typeof fetch;
    const backend = new HttpBackend({ url: 'http://example.test/turn', fetchImpl });
    await expect(backend.handle(sampleReq)).rejects.toThrow(/HTTP 500/);
  });
});
