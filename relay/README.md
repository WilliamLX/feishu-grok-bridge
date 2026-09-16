# Feishu → Grok Bot relay

Local Node.js relay that sits between the Feishu bridge `HttpBackend` and the Grok Bot local gateway.

```
Feishu bridge (GROK_BACKEND=http)
  → POST http://127.0.0.1:8787/turn  { agentId, text, ... }
  → relay validates agentId (required; catalog allowlist is mandatory)
  → writes inbox/<jobId>.json (includes agentId)
  → POST gateway /api/sendPrompt { agentId, prompt }  (marked [FEISHU_BRIDGE_JOB])
  → Grok Bot writes outbox/<jobId>.json {"reply":"..."}
  → relay returns {"reply":"..."} to HttpBackend
```

**Hard rule (M2a §5.2):** `agentId` is required on every `/turn`. There is **no** silent default (`GROK_BOT_AGENT_ID` / hardcoded UUID are not used as fallback). Missing/empty/whitespace → `400`; unknown vs the enabled catalog → `404`. The relay refuses to start when the catalog is missing, malformed, or has no enabled Bot.

## Requirements

- Node.js 20+
- Zero npm dependencies
- Gateway config at `/home/box/agent-data/gateway.json` (`token`, `port`)
- A valid `bots.json` catalog (or `BOT_CATALOG_PATH`) with at least one enabled Bot

## Start

From the bridge repo root:

```bash
node relay/server.mjs
```

From this directory:

```bash
npm start
# or
node server.mjs
```

Listen address: `127.0.0.1:8787` only.

## Feishu bridge `.env`

```bash
GROK_BACKEND=http
GROK_BOT_WEBHOOK_URL=http://127.0.0.1:8787/turn
# optional shared secret (must match on both sides)
GROK_BOT_WEBHOOK_TOKEN=
GROK_HTTP_TIMEOUT_MS=120000
# Bot catalog: each bot.id MUST be the real Grok Bot agent UUID used by sendPrompt
BOT_CATALOG_PATH=bots.json
```

## Endpoints

| Method | Path     | Behavior |
|--------|----------|----------|
| GET    | `/health`| `{ "ok": true }` |
| POST   | `/turn`  | Body `{ agentId, sessionId?, chatId?, userId?, text, history? }` → `{ "reply": "..." }` or 4xx/5xx |

### `/turn` agentId contract

| Condition | HTTP | Body |
|-----------|------|------|
| `agentId` missing / empty / whitespace | `400` | `{ "error": "unknown agent", "detail": "agentId required" }` |
| Catalog loaded and `agentId` not in enabled set | `404` | `{ "error": "unknown agent", "detail": "agentId not in enabled catalog: …" }` |
| Outbox timeout | `504` | `{ "error": "timeout waiting for Grok Bot reply" }` |
| `sendPrompt` failure | `502` | `{ "error": "sendPrompt failed", "detail": "…" }` |

Curl smoke (missing agentId → 400):

```bash
curl -sS -i -X POST http://127.0.0.1:8787/turn \
  -H 'Content-Type: application/json' \
  -d '{"text":"hi"}'
# expect HTTP/1.1 400 … {"error":"unknown agent","detail":"agentId required"}
```

Or run the tiny test script (starts nothing — assumes relay is up, or see script for self-contained checks):

```bash
node relay/test-agentid.mjs
```

## Env vars (relay)

| Var | Default | Meaning |
|-----|---------|---------|
| `GROK_RELAY_PORT` | `8787` | Listen port |
| `GROK_RELAY_TIMEOUT_MS` | `120000` | Outbox poll timeout |
| `GROK_RELAY_GATEWAY_TIMEOUT_MS` | `15000` | Gateway `sendPrompt` request timeout |
| `GROK_BOT_WEBHOOK_TOKEN` | _(empty)_ | If set, require `Authorization: Bearer …` on `/turn` |
| `GROK_GATEWAY_JSON` | `/home/box/agent-data/gateway.json` | Gateway token/port file |
| `BOT_CATALOG_PATH` | `bots.json` (under bridge root) | Required allowlist of enabled `id`s. Missing/unloadable/empty catalog stops relay startup; unknown agentId → 404. |

`GROK_BOT_AGENT_ID` is **not** read. Catalog / request body must supply the real agent UUID.

## Directories

Under the bridge repo root (gitignored — do not commit job JSON):

- `inbox/` — job request JSON written by the relay (includes `agentId`)
- `outbox/` — reply JSON written by Grok Bot
- `archive/` — inbox files moved here after a successful reply

## Bot catalog (`bots.json`)

Copy `bots.example.json` → `bots.json`. Each `"id"` must be the **real Grok Bot agent UUID** that `sendPrompt` expects (not a display slug). Placeholder ids in the example are for shape only — replace before production.

## Security

- Bound to loopback only
- Gateway bearer token is never logged
- Optional webhook bearer via `GROK_BOT_WEBHOOK_TOKEN`
- No default agent fallback
