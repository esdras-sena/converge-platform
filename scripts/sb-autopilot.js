#!/usr/bin/env node
/**
 * sb-autopilot.js
 *
 * Fully non-interactive tx automation for Converge using typhoon resolve-smart.js.
 *
 * What it does (MVP):
 * - Poll indexer for listed jobs
 * - Apply automatically when policy says it's profitable
 * - Broadcast via typhoon with skipAuth=true
 *
 * NOTE: This does NOT generate deliverables. It only automates onchain actions.
 * Pair it with your agent runtime to actually complete accepted work.
 *
 * Usage:
 *   node scripts/sb-autopilot.js '{
 *     "agentAddress":"0x...",
 *     "escrowAddress":"0x...",
 *     "interval":30,
 *     "minMarginPct":15,
 *     "maxApplications":10,
 *     "bidDiscountBps":500,
 *     "token":"0x...",
 *     "accountIndex":0,
 *     "dryRun":false,
 *     "statePath":"./.sb-autopilot-state.json"
 *   }'
 *
 * ENV:
 *   CONVERGE_API_URL (default http://localhost:3001)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const API = process.env.CONVERGE_API_URL || 'http://localhost:3001';

function fail(msg) {
  console.error(JSON.stringify({ error: msg }));
  process.exit(1);
}
function log(msg, extra) {
  console.error(`[sb-autopilot] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);
}

async function api(path, params = {}) {
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API ${res.status}`);
  }
  return res.json();
}

function loadState(p) {
  if (!p) return { seen: {} };
  if (!existsSync(p)) return { seen: {} };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { seen: {} }; }
}
function saveState(p, s) {
  if (!p) return;
  try { writeFileSync(p, JSON.stringify(s, null, 2) + '\n', 'utf8'); } catch {}
}

function bpsMul(x, bps) {
  // x * (10000 - bps) / 10000
  return (x * BigInt(10000 - bps)) / 10000n;
}

function runNode(scriptPath, jsonArg) {
  const r = spawnSync('node', [scriptPath, JSON.stringify(jsonArg)], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || `node ${scriptPath} failed`);
  }
  return JSON.parse(r.stdout);
}

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    fail('Missing JSON config');
  }

  let cfg;
  try { cfg = JSON.parse(raw); } catch (e) { fail(`JSON parse: ${e.message}`); }

  const {
    agentAddress,
    escrowAddress,
    interval = 30,
    minMarginPct = 15,
    maxApplications = 10,
    bidDiscountBps = 500, // 5% under max price
    token,
    accountIndex = 0,
    dryRun = false,
    statePath = './.sb-autopilot-state.json',
  } = cfg;

  if (!agentAddress) fail('Missing agentAddress');
  if (!escrowAddress) fail('Missing escrowAddress');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const sbPath = join(__dirname, 'sb.js');
  const typhoonResolve = join(__dirname, '..', '..', 'typhoon-starknet-account', 'scripts', 'resolve-smart.js');

  if (!existsSync(sbPath)) fail(`sb.js not found at ${sbPath}`);
  if (!existsSync(typhoonResolve)) {
    fail(`typhoon resolve-smart.js not found at ${typhoonResolve} (expected sibling skill)`);
  }

  const state = loadState(statePath);

  log('Starting', { interval, minMarginPct, maxApplications, bidDiscountBps, token, dryRun });

  while (true) {
    try {
      const jobs = await api('/api/discover/jobs', { limit: 50, token });
      const list = jobs.data || [];

      let applied = 0;
      for (const j of list) {
        if (applied >= maxApplications) break;

        const jobId = j.id;
        if (state.seen[String(jobId)]?.applied) continue;

        // Evaluate profitability via indexer payout endpoint
        const payout = await api(`/api/discover/jobs/${jobId}/payout`);
        const gross = Number(payout.gross);
        const net = Number(payout.net);
        const estTxCost = 0.004;
        const netAfterTx = net - estTxCost;
        const marginPct = gross > 0 ? (netAfterTx / gross) * 100 : 0;

        if (marginPct < minMarginPct) {
          state.seen[String(jobId)] = { skipped: true, marginPct, ts: Date.now() };
          continue;
        }

        // Bid price: discount from max price
        const maxPrice = BigInt(j.price);
        const bidPrice = bpsMul(maxPrice, bidDiscountBps);

        log('Applying', { jobId, marginPct: Math.round(marginPct * 100) / 100, bidPrice: bidPrice.toString() });

        const plan = runNode(sbPath, {
          cmd: 'plan',
          action: 'apply',
          jobId,
          bidPrice: bidPrice.toString(),
          escrowAddress,
          accountIndex,
          auto: true,
          dryRun,
        });

        // Execute via typhoon resolve-smart (non-interactive)
        const execResult = runNode(typhoonResolve, plan);

        state.seen[String(jobId)] = {
          applied: true,
          bidPrice: bidPrice.toString(),
          marginPct,
          ts: Date.now(),
          execResult: {
            canProceed: execResult.canProceed,
            nextStep: execResult.nextStep,
            execution: execResult.execution?.status,
          },
        };
        saveState(statePath, state);

        applied += 1;
      }

      if (!state._lastPoll) state._lastPoll = 0;
      state._lastPoll = Date.now();
      saveState(statePath, state);

    } catch (e) {
      log('Poll error', { error: e.message });
    }

    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

main().catch((e) => fail(e.message));
