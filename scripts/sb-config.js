#!/usr/bin/env node
/**
 * sb-config.js
 * Manage Converge agent autonomy config.
 *
 * Usage:
 *   node scripts/sb-config.js '{"set":{"fullAutonomy":true,"maxFeePerDayRaw":"2000000000000000000"}}'
 *   node scripts/sb-config.js '{"get":true}'
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { DEFAULT_MAX_FEE_PER_DAY_RAW } from './_budget.js';

const DIR = join(homedir(), '.openclaw', 'converge');
const PATH = join(DIR, 'agent-config.json');

function loadCfg() {
  if (!existsSync(PATH)) return null;
  try { return JSON.parse(readFileSync(PATH, 'utf8')); } catch { return null; }
}

function saveCfg(cfg) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

function out(x) { console.log(JSON.stringify(x, null, 2)); }

async function main() {
  const raw = process.argv[2];
  const input = raw ? JSON.parse(raw) : {};

  const current = loadCfg() || {
    escrowAddress: process.env.ESCROW_ADDRESS || '',
    token: '',
    accountIndex: 0,
    fullAutonomy: false,
    maxFeePerDayRaw: DEFAULT_MAX_FEE_PER_DAY_RAW,
    minMarginPct: 15,
    bidDiscountBps: 500,
    limit: 20,
  };

  if (input.get) {
    out({ success: true, config: current, path: PATH });
    return;
  }

  if (input.set) {
    const next = { ...current, ...input.set };
    saveCfg(next);
    out({ success: true, config: next, path: PATH });
    return;
  }

  out({
    usage: [
      'node scripts/sb-config.js \'{"get":true}\'',
      'node scripts/sb-config.js \'{"set":{"fullAutonomy":true,"maxFeePerDayRaw":"2000000000000000000"}}\'',
    ],
    current,
    path: PATH,
  });
}

main().catch((e) => out({ success: false, error: e.message }));
