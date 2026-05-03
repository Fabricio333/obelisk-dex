#!/usr/bin/env node
// Dev launcher: starts `next dev` and, if BOT_NSEC is set, the price bot.
import { spawn } from 'node:child_process';

const children = [];

function start(cmd, args, label) {
  const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('exit', (code, signal) => {
    console.log(`[${label}] exited (code=${code} signal=${signal})`);
    for (const c of children) if (c !== child && !c.killed) c.kill('SIGTERM');
    process.exit(code ?? 0);
  });
  return child;
}

start('npx', ['next', 'dev'], 'next');

if (process.env.BOT_NSEC) {
  start('node', ['scripts/price-bot.mjs'], 'price-bot');
} else {
  console.log('[dev] BOT_NSEC not set — skipping price bot. Set it in .env.local to enable.');
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const c of children) if (!c.killed) c.kill(sig);
  });
}
