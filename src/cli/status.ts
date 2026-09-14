import { loadConfig, redactSecrets, missingRequired } from '../config.js';
import { initLogger } from '../logger.js';

/**
 * Offline status: prints config readiness (no live WS handle in this process).
 * For runtime metrics, use `/status` inside Feishu while the bridge is running.
 */
export async function runStatus(): Promise<number> {
  const cfg = loadConfig();
  initLogger(cfg);

  console.log('📊 feishu-grok-bridge status (local config)\n');
  console.log(JSON.stringify(redactSecrets(cfg), null, 2));

  const missing = missingRequired(cfg, 'start');
  console.log();
  if (missing.length) {
    console.log('State: NOT READY');
    for (const m of missing) console.log(`  - missing: ${m}`);
    return 1;
  }
  console.log('State: READY (start with `npm run start` or `npm run dev`)');
  console.log('Runtime metrics: send `/status` to the bot in Feishu while running.');
  return 0;
}
