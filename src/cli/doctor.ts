import { loadConfig, missingRequired, redactSecrets } from '../config.js';
import { fetchTenantTokenHttp } from '../feishu/auth.js';
import { initLogger, log } from '../logger.js';

export async function runDoctor(): Promise<number> {
  const cfg = loadConfig();
  initLogger(cfg);

  console.log('🩺 feishu-grok-bridge doctor\n');
  console.log('Config (secrets redacted):');
  console.log(JSON.stringify(redactSecrets(cfg), null, 2));
  console.log();

  const missing = missingRequired(cfg, 'doctor');
  // Also surface ALLOW_FROM empty as warning for start readiness
  const startMissing = missingRequired(cfg, 'start');

  let exit = 0;

  if (missing.length) {
    exit = 1;
    console.log('❌ Missing required environment variables:');
    for (const m of missing) console.log(`   - ${m}`);
    console.log();
  } else {
    console.log('✅ FEISHU_APP_ID / FEISHU_APP_SECRET present');
  }

  if (cfg.allowFrom.length === 0) {
    exit = 1;
    console.log(
      '❌ ALLOW_FROM is empty — fail-closed deny-all. Set comma-separated open_id list before start.',
    );
  } else {
    console.log(`✅ ALLOW_FROM has ${cfg.allowFrom.length} open_id(s)`);
  }

  if (cfg.allowChats.length === 0) {
    console.log('⚠️  ALLOW_CHATS empty — any chat allowed (still gated by ALLOW_FROM)');
  } else {
    console.log(`✅ ALLOW_CHATS has ${cfg.allowChats.length} chat_id(s)`);
  }

  if (cfg.grokBackend === 'http' && !cfg.grokBotWebhookUrl) {
    exit = 1;
    console.log('❌ GROK_BACKEND=http but GROK_BOT_WEBHOOK_URL is empty');
  } else {
    console.log(`✅ GROK_BACKEND=${cfg.grokBackend}`);
  }

  // Live token probe only when credentials exist
  if (cfg.feishuAppId && cfg.feishuAppSecret) {
    console.log('\nProbing tenant_access_token…');
    const token = await fetchTenantTokenHttp({
      appId: cfg.feishuAppId,
      appSecret: cfg.feishuAppSecret,
      domain: cfg.feishuDomain,
    });
    if (token.ok) {
      console.log(`✅ tenant_access_token OK (expire≈${token.expire ?? '?'}s)`);
    } else {
      exit = 1;
      console.log(`❌ tenant_access_token failed: ${token.error}`);
      console.log('   Check APP_ID/SECRET and FEISHU_DOMAIN (feishu vs lark).');
    }
  } else {
    console.log('\n⏭️  Skipping token probe (credentials missing)');
  }

  if (startMissing.length && !missing.length) {
    // already printed ALLOW_FROM
  }

  console.log();
  if (exit === 0) {
    console.log('🎉 Doctor passed — ready to `npm run start` / `npm run dev`.');
  } else {
    console.log('Doctor found issues. Copy `.env.example` → `.env` and fill values.');
    log.debug('doctor exit', { exit });
  }
  return exit;
}
