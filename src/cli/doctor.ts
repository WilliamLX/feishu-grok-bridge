import { loadConfig, missingRequired, redactSecrets } from '../config.js';
import { fetchTenantTokenHttp, fetchBotInfo } from '../feishu/auth.js';
import { initLogger, log } from '../logger.js';
import { loadBotCatalogFromPath } from '../core/bots.js';

export async function runDoctor(): Promise<number> {
  const cfg = loadConfig();
  initLogger(cfg);

  console.log('🩺 feishu-grok-bridge doctor\n');
  console.log('Config (secrets redacted):');
  console.log(JSON.stringify(redactSecrets(cfg), null, 2));
  console.log();

  const missing = missingRequired(cfg, 'doctor');

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
    console.log(
      '⚠️  ALLOW_FROM is empty — fail-closed for normal chat.',
    );
    console.log(
      '   Bootstrap: start the bridge, DM the bot `/whoami`, put the returned open_id into ALLOW_FROM, restart.',
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

  const { catalog, warning } = loadBotCatalogFromPath(cfg.botCatalogPath);
  if (warning) {
    console.log(`⚠️  Bot catalog: ${warning}`);
    console.log('   Copy bots.example.json → bots.json (or set BOT_CATALOG_PATH). Chat is fail-closed until catalog loads.');
  } else {
    const n = catalog.listEnabled().length;
    console.log(`✅ Bot catalog ${cfg.botCatalogPath} — ${n} enabled bot(s)`);
    if (n === 0) {
      console.log('   ⚠️  Enabled list is empty — users cannot bind a Bot.');
    }
  }
  console.log(`ℹ️  Binding store path: ${cfg.bindingStorePath} (restart-safe; delete the file to reset bindings)`);

  // Live token + bot identity probe only when credentials exist
  if (cfg.feishuAppId && cfg.feishuAppSecret) {
    console.log('\nProbing tenant_access_token…');
    const token = await fetchTenantTokenHttp({
      appId: cfg.feishuAppId,
      appSecret: cfg.feishuAppSecret,
      domain: cfg.feishuDomain,
    });
    if (token.ok && token.token) {
      console.log(`✅ tenant_access_token OK (expire≈${token.expire ?? '?'}s)`);
      console.log('Probing bot/v3/info (bot open_id)…');
      const bot = await fetchBotInfo({
        appId: cfg.feishuAppId,
        appSecret: cfg.feishuAppSecret,
        domain: cfg.feishuDomain,
        tenantAccessToken: token.token,
      });
      if (bot.ok && bot.openId) {
        console.log(
          `✅ bot open_id OK (${bot.openId.slice(0, 8)}…) name=${bot.appName ?? '?'}`,
        );
      } else {
        exit = 1;
        console.log(`❌ bot/v3/info failed: ${bot.error}`);
        console.log('   Group @mention matching needs bot open_id. Check bot ability is enabled.');
      }
    } else {
      exit = 1;
      console.log(`❌ tenant_access_token failed: ${token.error}`);
      console.log('   Check APP_ID/SECRET and FEISHU_DOMAIN (feishu vs lark).');
    }
  } else {
    console.log('\n⏭️  Skipping token probe (credentials missing)');
  }

  console.log();
  if (exit === 0) {
    if (cfg.allowFrom.length === 0) {
      console.log(
        '🎉 Doctor passed credentials — you may `npm run start` and DM `/whoami` to bootstrap ALLOW_FROM.',
      );
    } else {
      console.log('🎉 Doctor passed — ready to `npm run start` / `npm run dev`.');
    }
  } else {
    console.log('Doctor found issues. Copy `.env.example` → `.env` and fill values.');
    log.debug('doctor exit', { exit });
  }
  return exit;
}
