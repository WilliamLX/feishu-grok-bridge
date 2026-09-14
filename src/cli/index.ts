#!/usr/bin/env node
import { Command } from 'commander';
import { runDoctor } from './doctor.js';
import { runStart } from './start.js';
import { runStatus } from './status.js';

const program = new Command();

program
  .name('feishu-grok-bridge')
  .description('Feishu/Lark ↔ Grok Bot remote-control bridge')
  .version('1.0.0');

program
  .command('doctor')
  .description('Validate env config and probe Feishu tenant_access_token')
  .action(async () => {
    const code = await runDoctor();
    process.exit(code);
  });

program
  .command('start')
  .description('Start WebSocket bridge')
  .action(async () => {
    await runStart();
  });

program
  .command('status')
  .description('Show local config readiness')
  .action(async () => {
    const code = await runStatus();
    process.exit(code);
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
