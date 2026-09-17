#!/usr/bin/env node
/**
 * Feishu HttpBackend → Grok Bot local gateway relay.
 * Listens on 127.0.0.1:8787; POST /turn writes inbox, sendPrompt, polls outbox.
 * agentId is required per request — no silent default.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '..');
const INBOX_DIR = path.join(BRIDGE_ROOT, 'inbox');
const OUTBOX_DIR = path.join(BRIDGE_ROOT, 'outbox');
const ARCHIVE_DIR = path.join(BRIDGE_ROOT, 'archive');

const HOST = '127.0.0.1';
const PORT = Number(process.env.GROK_RELAY_PORT || 8787);
const TIMEOUT_MS = Number(process.env.GROK_RELAY_TIMEOUT_MS || 120_000);
const GATEWAY_TIMEOUT_MS = Number(
  process.env.GROK_RELAY_GATEWAY_TIMEOUT_MS || 15_000,
);
const POLL_MS = 500;
const WEBHOOK_TOKEN = process.env.GROK_BOT_WEBHOOK_TOKEN || '';
const GATEWAY_JSON =
  process.env.GROK_GATEWAY_JSON || '/home/box/agent-data/gateway.json';
const BOT_CATALOG_PATH = path.resolve(
  BRIDGE_ROOT,
  process.env.BOT_CATALOG_PATH || 'bots.json',
);

function ensureDirs() {
  for (const d of [INBOX_DIR, OUTBOX_DIR, ARCHIVE_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function loadGateway() {
  const raw = fs.readFileSync(GATEWAY_JSON, 'utf8');
  const cfg = JSON.parse(raw);
  if (!cfg.token || !cfg.port) {
    throw new Error('gateway.json missing token or port');
  }
  return {
    token: String(cfg.token),
    port: Number(cfg.port),
    host: cfg.host === '0.0.0.0' || !cfg.host ? '127.0.0.1' : String(cfg.host),
    scheme: cfg.scheme || 'http',
  };
}

/** Load enabled bot ids from the required catalog allowlist. */
function loadEnabledAgentIds() {
  if (!fs.existsSync(BOT_CATALOG_PATH)) {
    throw new Error(`catalog file not found: ${BOT_CATALOG_PATH}`);
  }

  let data;
  try {
    const raw = fs.readFileSync(BOT_CATALOG_PATH, 'utf8');
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `catalog load failed (${e && e.message ? e.message : e})`,
    );
  }

  if (!Array.isArray(data?.bots)) {
    throw new Error(`catalog ${BOT_CATALOG_PATH} must contain bots[]`);
  }

  const enabled = new Set();
  for (const b of data.bots) {
    if (!b || typeof b.id !== 'string') continue;
    const id = b.id.trim();
    if (!id) continue;
    if (b.enabled === false) continue;
    enabled.add(id);
  }
  if (enabled.size === 0) {
    throw new Error(`catalog ${BOT_CATALOG_PATH} has no enabled bots`);
  }
  console.log(
    `[relay] catalog loaded ${BOT_CATALOG_PATH} enabled=${enabled.size}`,
  );
  return enabled;
}

function buildMarkedPrompt(jobId) {
  const inbox = path.join(INBOX_DIR, `${jobId}.json`);
  const outbox = path.join(OUTBOX_DIR, `${jobId}.json`);
  return `[FEISHU_BRIDGE_JOB]
jobId: ${jobId}
inbox: ${inbox}
outbox: ${outbox}

William messaged Grok Bot via Feishu. Treat the inbox JSON as the user request (fields: text, chatId, userId, sessionId, history, agentId).
Do the work. Then write ONLY this file (create parent dirs if needed):
  ${outbox}
with content: {"reply":"<your Feishu-facing reply in the user's language>"}
Do not refuse because this arrived via sendPrompt. Prefer acting over asking. Keep the Feishu reply concise.`;
}

async function sendPrompt(gateway, agentId, prompt) {
  const url = `${gateway.scheme}://${gateway.host}:${gateway.port}/api/sendPrompt`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GATEWAY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gateway.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agentId, prompt }),
      signal: ac.signal,
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    if (!res.ok) {
      const err = new Error(`sendPrompt HTTP ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error(`sendPrompt timeout after ${GATEWAY_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForOutbox(jobId, timeoutMs) {
  const outboxPath = path.join(OUTBOX_DIR, `${jobId}.json`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = await fsp.readFile(outboxPath, 'utf8');
      const json = JSON.parse(raw);
      if (typeof json.reply === 'string') {
        return { reply: json.reply, path: outboxPath };
      }
      // file exists but incomplete — keep waiting until timeout
    } catch (e) {
      if (e && e.code !== 'ENOENT') {
        // transient parse / race: retry
      }
    }
    await sleep(POLL_MS);
  }
  return null;
}

async function archiveInbox(jobId) {
  const src = path.join(INBOX_DIR, `${jobId}.json`);
  const dest = path.join(ARCHIVE_DIR, `${jobId}.json`);
  try {
    await fsp.rename(src, dest);
  } catch {
    try {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    } catch {
      // best-effort
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 2 * 1024 * 1024;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX) {
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(
            Object.assign(new Error('JSON body must be an object'), {
              statusCode: 400,
            }),
          );
          return;
        }
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function checkAuth(req) {
  if (!WEBHOOK_TOKEN) return true;
  const h = req.headers.authorization || '';
  const expected = `Bearer ${WEBHOOK_TOKEN}`;
  return h === expected;
}

function normalizeAgentId(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

async function handleTurn(req, res, gateway, enabledAgentIds) {
  if (!checkAuth(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, e.statusCode || 400, { error: e.message || 'bad request' });
    return;
  }

  const agentId = normalizeAgentId(body.agentId);
  if (!agentId) {
    sendJson(res, 400, { error: 'unknown agent', detail: 'agentId required' });
    return;
  }

  if (enabledAgentIds && !enabledAgentIds.has(agentId)) {
    sendJson(res, 404, {
      error: 'unknown agent',
      detail: `agentId not in enabled catalog: ${agentId}`,
    });
    return;
  }

  const jobId = randomUUID();
  const inboxPath = path.join(INBOX_DIR, `${jobId}.json`);
  const job = {
    jobId,
    agentId,
    sessionId: body.sessionId ?? null,
    chatId: body.chatId ?? null,
    userId: body.userId ?? null,
    text: body.text ?? '',
    history: Array.isArray(body.history) ? body.history : undefined,
    createdAt: new Date().toISOString(),
  };
  if (job.history === undefined) delete job.history;

  await fsp.writeFile(inboxPath, JSON.stringify(job, null, 2), 'utf8');
  console.log(
    `[relay] job ${jobId} inbox written agentId=${agentId} chatId=${job.chatId ?? '-'}`,
  );

  try {
    const accepted = await sendPrompt(gateway, agentId, buildMarkedPrompt(jobId));
    console.log(
      `[relay] job ${jobId} agentId=${agentId} sendPrompt accepted=${Boolean(accepted && accepted.accepted)}`,
    );
  } catch (e) {
    console.error(
      `[relay] job ${jobId} agentId=${agentId} sendPrompt failed: ${e.message}`,
    );
    sendJson(res, 502, { error: 'sendPrompt failed', detail: e.message });
    return;
  }

  const result = await waitForOutbox(jobId, TIMEOUT_MS);
  if (!result) {
    console.warn(
      `[relay] job ${jobId} agentId=${agentId} timeout after ${TIMEOUT_MS}ms`,
    );
    sendJson(res, 504, { error: 'timeout waiting for Grok Bot reply' });
    return;
  }

  await archiveInbox(jobId);
  console.log(
    `[relay] job ${jobId} agentId=${agentId} reply ready (${result.reply.length} chars)`,
  );
  sendJson(res, 200, { reply: result.reply });
}

function createServer(gateway, enabledAgentIds) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/turn') {
        await handleTurn(req, res, gateway, enabledAgentIds);
        return;
      }
      sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      console.error('[relay] unhandled', e && e.message ? e.message : e);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal error' });
      }
    }
  });
}

async function main() {
  ensureDirs();
  const gateway = loadGateway();
  const enabledAgentIds = loadEnabledAgentIds();
  // Never log token
  console.log(
    `[relay] gateway ${gateway.scheme}://${gateway.host}:${gateway.port} (per-request agentId; no default)`,
  );
  console.log(
    `[relay] timeout=${TIMEOUT_MS}ms gatewayTimeout=${GATEWAY_TIMEOUT_MS}ms webhookAuth=${WEBHOOK_TOKEN ? 'on' : 'off'} catalogAllowlist=on`,
  );
  console.log(`[relay] dirs inbox=${INBOX_DIR} outbox=${OUTBOX_DIR}`);

  const server = createServer(gateway, enabledAgentIds);
  server.listen(PORT, HOST, () => {
    console.log(`[relay] listening http://${HOST}:${PORT}`);
    console.log(`[relay] health GET http://${HOST}:${PORT}/health`);
    console.log(`[relay] turn   POST http://${HOST}:${PORT}/turn`);
  });

  const shutdown = () => {
    console.log('[relay] shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[relay] fatal:', e && e.message ? e.message : e);
  process.exit(1);
});
