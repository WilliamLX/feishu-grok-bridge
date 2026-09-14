import { loadConfig, missingRequired, redactSecrets } from '../config.js';
import { initLogger, log } from '../logger.js';
import { createLarkClient, fetchBotInfo } from '../feishu/auth.js';
import { startWsClient } from '../feishu/ws.js';
import { createBackend } from '../backend/index.js';
import { BridgeCore } from '../core/bridge.js';

export async function runStart(): Promise<void> {
  const cfg = loadConfig();
  initLogger(cfg);

  const missing = missingRequired(cfg, 'start');
  if (missing.length) {
    console.error('❌ Cannot start — missing configuration:');
    for (const m of missing) console.error(`   - ${m}`);
    console.error('\nRun `npm run doctor` for details. See .env.example.');
    process.exit(1);
  }

  if (cfg.allowFrom.length === 0) {
    log.warn(
      'ALLOW_FROM is empty — fail-closed for normal chat; only bootstrap /whoami is allowed until you set ALLOW_FROM',
    );
  }

  log.info('starting bridge', redactSecrets(cfg));

  const client = createLarkClient({
    appId: cfg.feishuAppId,
    appSecret: cfg.feishuAppSecret,
    domain: cfg.feishuDomain,
  });

  let botOpenId: string | undefined;
  // Bound so a stalled Feishu HTTP call cannot block WS startup forever.
  const botInfo = await fetchBotInfo({
    appId: cfg.feishuAppId,
    appSecret: cfg.feishuAppSecret,
    domain: cfg.feishuDomain,
    timeoutMs: 10_000,
  });
  if (botInfo.ok && botInfo.openId) {
    botOpenId = botInfo.openId;
  } else {
    log.warn(
      'could not resolve bot open_id — group @mention matching will be unavailable until this succeeds',
      { error: botInfo.error },
    );
  }

  const backend = createBackend(cfg);
  const bridge = new BridgeCore({ cfg, client, backend, botOpenId });

  const ws = startWsClient({
    appId: cfg.feishuAppId,
    appSecret: cfg.feishuAppSecret,
    domain: cfg.feishuDomain,
    onMessage: (msg) => bridge.handleIncoming(msg),
  });

  const shutdown = () => {
    log.info('shutting down…');
    ws.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log.info(`bridge online — backend=${backend.name}`, {
    botOpenIdKnown: Boolean(botOpenId),
  });
  // Keep process alive
  await new Promise(() => {
    /* run until signal */
  });
}
