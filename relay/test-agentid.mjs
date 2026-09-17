#!/usr/bin/env node
/**
 * Tiny smoke checks for POST /turn agentId contract (M2a §5.2).
 * Starts a short-lived relay on an ephemeral port with a stub gateway
 * so this can run without a live Grok Bot.
 *
 * Usage: node relay/test-agentid.mjs
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(__dirname, 'server.mjs');

function listenStubGateway() {
  return new Promise((resolve) => {
    const jobs = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        const parsed = JSON.parse(body);
        const jobId = parsed.prompt?.match(/^jobId: (.+)$/m)?.[1];
        const outboxPath = parsed.prompt?.match(/^outbox: (.+)$/m)?.[1];
        jobs.push({ agentId: parsed.agentId, jobId, outboxPath });
        if (outboxPath) {
          await fsp.writeFile(
            outboxPath,
            JSON.stringify({ reply: `stub:${parsed.agentId}` }),
            'utf8',
          );
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ accepted: true }));
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ srv, port, jobs });
    });
  });
}

function pickFreePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function waitForExit(child, ms = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('child process exit timeout'));
    }, ms);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function postTurn(port, payload) {
  const res = await fetch(`http://127.0.0.1:${port}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function waitHealth(port, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('relay health timeout');
}

async function main() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'relay-agentid-'));
  const gwPath = path.join(tmp, 'gateway.json');
  const catalogPath = path.join(tmp, 'bots.json');
  await fsp.writeFile(
    catalogPath,
    JSON.stringify({
      bots: [
        {
          id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          name: 'Test',
          enabled: true,
        },
      ],
    }),
  );

  const { srv: gw, port: gwPort, jobs } = await listenStubGateway();
  await fsp.writeFile(
    gwPath,
    JSON.stringify({ token: 'test-token-not-secret-for-unit', port: gwPort }),
  );

  const relayPort = await pickFreePort();
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      GROK_RELAY_PORT: String(relayPort),
      GROK_GATEWAY_JSON: gwPath,
      BOT_CATALOG_PATH: catalogPath,
      GROK_RELAY_GATEWAY_TIMEOUT_MS: '1000',
      GROK_BOT_WEBHOOK_TOKEN: '',
      // Ensure env default is NOT used even if set in parent
      GROK_BOT_AGENT_ID: 'should-never-be-used',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let childLog = '';
  child.stdout.on('data', (d) => (childLog += d));
  child.stderr.on('data', (d) => (childLog += d));

  const failures = [];
  try {
    await waitHealth(relayPort);

    const missing = await postTurn(relayPort, { text: 'hi' });
    if (
      missing.status !== 400 ||
      missing.json?.error !== 'unknown agent' ||
      missing.json?.detail !== 'agentId required'
    ) {
      failures.push(`missing agentId: got ${missing.status} ${JSON.stringify(missing.json)}`);
    } else {
      console.log('ok: missing agentId → 400');
    }

    const blank = await postTurn(relayPort, { agentId: '   ', text: 'hi' });
    if (
      blank.status !== 400 ||
      blank.json?.error !== 'unknown agent' ||
      blank.json?.detail !== 'agentId required'
    ) {
      failures.push(`whitespace agentId: got ${blank.status} ${JSON.stringify(blank.json)}`);
    } else {
      console.log('ok: whitespace agentId → 400');
    }

    const nonObject = await postTurn(relayPort, null);
    if (
      nonObject.status !== 400 ||
      nonObject.json?.error !== 'JSON body must be an object'
    ) {
      failures.push(
        `non-object JSON body: got ${nonObject.status} ${JSON.stringify(nonObject.json)}`,
      );
    } else {
      console.log('ok: non-object JSON body → 400');
    }

    const unknown = await postTurn(relayPort, {
      agentId: '00000000-0000-0000-0000-000000000000',
      text: 'hi',
    });
    if (
      unknown.status !== 404 ||
      unknown.json?.error !== 'unknown agent'
    ) {
      failures.push(`unknown catalog agentId: got ${unknown.status} ${JSON.stringify(unknown.json)}`);
    } else {
      console.log('ok: fake agentId not in catalog → 404');
    }

    const validAgentId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const valid = await postTurn(relayPort, {
      agentId: validAgentId,
      chatId: 'oc_test',
      text: 'hello',
    });
    const validJob = jobs.at(-1);
    if (
      valid.status !== 200 ||
      valid.json?.reply !== `stub:${validAgentId}` ||
      validJob?.agentId !== validAgentId ||
      !validJob.jobId
    ) {
      failures.push(`valid agentId turn: got ${valid.status} ${JSON.stringify(valid.json)}`);
    } else {
      const archivePath = path.join(ROOT, 'archive', `${validJob.jobId}.json`);
      const inboxPath = path.join(ROOT, 'inbox', `${validJob.jobId}.json`);
      if (!fs.existsSync(archivePath) || fs.existsSync(inboxPath)) {
        failures.push('successful turn did not archive inbox job');
      } else {
        console.log('ok: valid agentId turn → 200 and inbox archived');
      }
      await fsp.rm(validJob.outboxPath, { force: true });
      await fsp.rm(archivePath, { force: true });
    }
  } finally {
    child.kill('SIGTERM');
    await waitForExit(child);

    const missingCatalogChild = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: {
        ...process.env,
        GROK_RELAY_PORT: String(await pickFreePort()),
        GROK_GATEWAY_JSON: gwPath,
        BOT_CATALOG_PATH: path.join(tmp, 'missing-bots.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let missingCatalogLog = '';
    missingCatalogChild.stdout.on('data', (d) => (missingCatalogLog += d));
    missingCatalogChild.stderr.on('data', (d) => (missingCatalogLog += d));
    const missingCatalogExit = await waitForExit(missingCatalogChild);
    if (
      missingCatalogExit.code !== 1 ||
      !missingCatalogLog.includes('catalog file not found')
    ) {
      failures.push(
        `missing catalog startup: got ${JSON.stringify(missingCatalogExit)} ${missingCatalogLog}`,
      );
    } else {
      console.log('ok: missing catalog → relay refuses to start');
    }

    await new Promise((resolve) => gw.close(resolve));
    try {
      await fsp.rm(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  if (failures.length) {
    console.error('FAIL:\n' + failures.map((f) => '  - ' + f).join('\n'));
    if (childLog) console.error('--- relay log ---\n' + childLog);
    process.exit(1);
  }
  console.log('all agentId contract checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
