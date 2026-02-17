#!/usr/bin/env node
/**
 * sb-watch-smart.js
 *
 * Near-real-time Converge watcher using typhoon-starknet-account/watch-events-smart.js
 * (WebSocket subscribeEvents + polling fallback).
 *
 * Usage:
 *   node scripts/sb-watch-smart.js '{"escrowAddress":"0x...","events":["JobListed"],"mode":"auto"}'
 *
 * Defaults:
 * - events: JobListed, JobAccepted, JobResolved, ServiceHired
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

function fail(msg) {
  console.error(JSON.stringify({ error: msg }));
  process.exit(1);
}

async function main() {
  const raw = process.argv[2];
  let cfg = {};
  if (raw) {
    try { cfg = JSON.parse(raw); } catch (e) { fail(`JSON parse: ${e.message}`); }
  }

  const escrowAddress = cfg.escrowAddress || process.env.ESCROW_ADDRESS;
  if (!escrowAddress) fail('Missing escrowAddress or ESCROW_ADDRESS');

  const events = cfg.events || ['JobListed','JobAccepted','JobResolved','ServiceHired'];

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const watcher = join(__dirname, '..', '..', 'typhoon-starknet-account', 'scripts', 'watch-events-smart.js');
  if (!existsSync(watcher)) fail(`Typhoon watcher not found at ${watcher}`);

  const input = {
    contractAddress: escrowAddress,
    eventNames: events,
    mode: cfg.mode || 'auto',
    pollIntervalMs: cfg.pollIntervalMs || 3000,
    wsRpcUrl: cfg.wsRpcUrl,
    httpRpcUrl: cfg.httpRpcUrl,
    healthCheckIntervalMs: cfg.healthCheckIntervalMs || 30000,
  };

  const child = spawn('node', [watcher, JSON.stringify(input)], { stdio: ['ignore','pipe','pipe'] });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  child.on('exit', (code) => process.exit(code || 0));
}

main().catch((e) => fail(e.message));
