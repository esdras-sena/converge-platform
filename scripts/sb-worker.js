#!/usr/bin/env node
/**
 * sb-worker.js (Option A)
 *
 * Runs an autonomy loop:
 * - Watches indexer for listed jobs
 * - Evaluates + plans bids
 * - Enforces max fee spend/day (default 2 STRK)
 * - If fullAutonomy=true: broadcasts via typhoon (skipAuth=true)
 * - If fullAutonomy=false: creates pending approvals (no broadcast)
 *
 * Usage:
 *   node scripts/sb-worker.js '{
 *     "escrowAddress":"0x...",
 *     "fullAutonomy":true,
 *     "accountIndex":0,
 *     "maxFeePerDayRaw":"2000000000000000000",
 *     "minMarginPct":15,
 *     "bidDiscountBps":500,
 *     "token":"0x...",
 *     "limit":20,
 *     "dryRun":false
 *   }'
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { DEFAULT_MAX_FEE_PER_DAY_RAW, canSpendMore, recordSpendRaw } from './_budget.js';
import { getAccountAddress } from './_accounts.js';
import { shouldOutsource } from './_outsource_policy.js';

const API = process.env.CONVERGE_API_URL || 'http://localhost:3001';
const DIR = join(homedir(), '.openclaw', 'converge');
const PENDING = join(DIR, 'pending.json');
const STATE = join(DIR, 'worker-state.json');

function out(x) { console.log(JSON.stringify(x, null, 2)); }
function log(x) { console.error(`[sb-worker] ${x}`); }
function fail(msg) { console.error(JSON.stringify({ error: msg })); process.exit(1); }

async function api(path, params = {}) {
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

function loadJson(p, fallback) {
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}
function saveJson(p, obj) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function runNode(scriptPath, jsonArg) {
  const r = spawnSync('node', [scriptPath, JSON.stringify(jsonArg)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || `node failed: ${scriptPath}`);
  return JSON.parse(r.stdout);
}

function newId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

async function main() {
  const raw = process.argv[2];
  let cfg = {};
  if (raw) {
    try { cfg = JSON.parse(raw); } catch (e) { fail(`JSON parse: ${e.message}`); }
  }

  const { loadConfig } = await import('./_config.js');
  const base = loadConfig();
  cfg = { ...base, ...cfg };

  const escrowAddress = cfg.escrowAddress;
  if (!escrowAddress) fail('Missing escrowAddress (set in sb-config.js or ESCROW_ADDRESS env)');

  const fullAutonomy = Boolean(cfg.fullAutonomy);
  const accountIndex = Number.isFinite(Number(cfg.accountIndex)) ? Number(cfg.accountIndex) : 0;
  const accountAddress = getAccountAddress(accountIndex);

  const maxFeePerDayRaw = cfg.maxFeePerDayRaw || DEFAULT_MAX_FEE_PER_DAY_RAW; // 2 STRK
  const minMarginPct = cfg.minMarginPct ?? 15;
  const bidDiscountBps = cfg.bidDiscountBps ?? 500;
  const token = cfg.token;
  const limit = cfg.limit ?? 20;
  const dryRun = Boolean(cfg.dryRun);

  // Outsourcing policy knobs
  const availableCreditsRaw = String(cfg.availableCreditsRaw ?? '0');
  const minReserveCreditsRaw = String(cfg.minReserveCreditsRaw ?? '0');
  const maxSubcontractSpendPct = Number(cfg.maxSubcontractSpendPct ?? 40);
  const defaultConfidence = Number(cfg.defaultConfidence ?? 0.7);
  const defaultDeadlineRisk = Number(cfg.defaultDeadlineRisk ?? 0.2);
  const expectedSubcontractCostPct = Number(cfg.expectedSubcontractCostPct ?? 35);
  const minJobOutsourceComplexity = Number(cfg.minJobOutsourceComplexity ?? 22);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const sbPath = join(__dirname, 'sb.js');
  const sbCyclePath = join(__dirname, 'sb-cycle.js');
  const estPath = join(__dirname, 'estimate-invoke-fee.js');
  const typhoonResolve = join(__dirname, '..', '..', 'typhoon-starknet-account', 'scripts', 'resolve-smart.js');

  const state = loadJson(STATE, { seenJobs: {} });
  const pending = loadJson(PENDING, { items: [] });

  let list = [];
  try {
    const jobs = await api('/api/discover/jobs', { limit, token });
    list = jobs.data || [];
  } catch (e) {
    out({ success: false, error: `indexer_unavailable: ${e.message}`, escrowAddress, fullAutonomy });
    return;
  }

  const decisions = [];

  for (const j of list) {
    const jobId = j.id;
    if (state.seenJobs[String(jobId)]) continue;

    const payout = await api(`/api/discover/jobs/${jobId}/payout`);
    const gross = Number(payout.gross);
    const net = Number(payout.net);
    const estTxCost = 0.004;
    const netAfterTx = net - estTxCost;
    const marginPct = gross > 0 ? (netAfterTx / gross) * 100 : 0;

    if (marginPct < minMarginPct) {
      state.seenJobs[String(jobId)] = { skipped: true, marginPct, ts: Date.now() };
      continue;
    }

    // bid = max price * (10000 - discount)/10000
    const maxPrice = BigInt(j.price);
    const bidPrice = (maxPrice * BigInt(10000 - bidDiscountBps)) / 10000n;

    // Build plan (auto controls set later based on fullAutonomy)
    const plan = runNode(sbPath, {
      cmd: 'plan',
      action: 'apply',
      jobId,
      bidPrice: bidPrice.toString(),
      escrowAddress,
      accountIndex,
      auto: fullAutonomy,
      dryRun,
    });

    // Estimate fee (STRK wei) for this call
    // Convert resolve-smart operations → estimate-invoke-fee calls
    const ops = plan.parsed.operations || [];
    const calls = ops.map((op) => ({
      contractAddress: op.contractAddress,
      method: op.action,
      // starknet.js populate accepts either positional array or named-args object
      args: op.args ?? [],
    }));

    let feeRaw = null;
    try {
      const est = runNode(estPath, { accountAddress, calls });
      // starknet.js fee estimate shape varies; try common fields
      feeRaw = est?.estimate?.overall_fee || est?.estimate?.overallFee || est?.estimate?.suggested_max_fee;
      if (feeRaw === undefined || feeRaw === null) feeRaw = '0';
    } catch (e) {
      // If fee estimation fails, fail closed
      decisions.push({ jobId, action: 'skip', reason: 'fee_estimate_failed', error: e.message });
      state.seenJobs[String(jobId)] = { skipped: true, reason: 'fee_estimate_failed', ts: Date.now() };
      continue;
    }

    // Budget check
    if (!canSpendMore(maxFeePerDayRaw, feeRaw)) {
      decisions.push({ jobId, action: 'skip', reason: 'daily_fee_cap', feeRaw });
      state.seenJobs[String(jobId)] = { skipped: true, reason: 'daily_fee_cap', feeRaw, ts: Date.now() };
      continue;
    }

    if (!fullAutonomy) {
      // Create pending approval
      const id = newId();
      pending.items.push({
        id,
        createdAt: Date.now(),
        kind: 'apply_job',
        jobId,
        bidPrice: bidPrice.toString(),
        feeEstimateRaw: String(feeRaw),
        plan: { ...plan, skipAuth: false, dryRun },
      });
      decisions.push({ jobId, action: 'pending', id, feeRaw: String(feeRaw) });
      state.seenJobs[String(jobId)] = { pending: true, id, ts: Date.now() };
      continue;
    }

    // Broadcast via typhoon resolve-smart (non-interactive)
    const execResult = runNode(typhoonResolve, plan);

    // If broadcast completed, record spend
    const status = execResult.execution?.status;
    if (status === 'completed') {
      recordSpendRaw(String(feeRaw), { kind: 'apply_job', jobId, bidPrice: bidPrice.toString() });
    }

    decisions.push({ jobId, action: 'broadcast', feeRaw: String(feeRaw), status, nextStep: execResult.nextStep });
    state.seenJobs[String(jobId)] = { broadcast: true, status, ts: Date.now() };
  }

  // Outsourcing pass (from accepted jobs already assigned to this agent)
  try {
    const cycle = runNode(sbCyclePath, {
      escrowAddress,
      accountIndex,
      availableCreditsRaw,
      minReserveCreditsRaw,
      maxSubcontractSpendPct,
      defaultConfidence,
      defaultDeadlineRisk,
      expectedSubcontractCostPct,
      minJobOutsourceComplexity,
    });

    for (const rec of cycle.outsourceRecommendations || []) {
      if (!rec?.outsource || !rec?.route) continue;
      const src = (cycle.jobs || []).find((j) => Number(j.jobId) === Number(rec.jobId));
      if (!src) continue;

      if (rec.route === 'job') {
        const id = newId();
        pending.items.push({
          id,
          createdAt: Date.now(),
          kind: 'outsource_list_job',
          sourceJobId: src.jobId,
          title: `Subtask for job #${src.jobId}`,
          description: src.description || src.title || '',
          token: src.token,
          price: src.price,
          deadlineTs: src.deadline_ts,
          policy: rec,
          note: 'Jobs lane selected (micro/generic). Manual review required before broadcast.',
        });
        decisions.push({ jobId: src.jobId, action: 'outsource_pending', route: 'job', reason: rec.reason });
        continue;
      }

      // service lane (specialist). Try auto-hire when full autonomy is enabled.
      let services = { data: [] };
      try {
        services = await api('/api/discover/services', {
          q: src.title || '',
          token: src.token || '',
          limit: 10,
        });
      } catch {}

      const candidate = (services.data || [])[0];
      if (!candidate) {
        const id = newId();
        pending.items.push({
          id,
          createdAt: Date.now(),
          kind: 'outsource_hire_service',
          sourceJobId: src.jobId,
          query: src.title || '',
          token: src.token,
          policy: rec,
          note: 'Service lane selected but no candidate found automatically.',
        });
        decisions.push({ jobId: src.jobId, action: 'outsource_pending', route: 'service', reason: 'no_candidate' });
        continue;
      }

      if (!fullAutonomy) {
        const id = newId();
        pending.items.push({
          id,
          createdAt: Date.now(),
          kind: 'outsource_hire_service',
          sourceJobId: src.jobId,
          serviceId: candidate.id,
          token: candidate.token,
          price: candidate.price,
          policy: rec,
          note: 'Service lane selected (specialist). Approval required.',
        });
        decisions.push({ jobId: src.jobId, action: 'outsource_pending', route: 'service', serviceId: candidate.id });
        continue;
      }

      const now = Math.floor(Date.now() / 1000);
      const deadlineTs = src.deadline_ts ? Math.max(now + 1800, Number(src.deadline_ts) - 900) : (now + 86400);
      const hirePlan = runNode(sbPath, {
        cmd: 'plan',
        action: 'hire-service',
        serviceId: Number(candidate.id),
        deadlineTs,
        token: candidate.token,
        price: String(candidate.price),
        escrowAddress,
        accountIndex,
        auto: true,
        dryRun,
      });
      const execResult = runNode(typhoonResolve, hirePlan);
      decisions.push({
        jobId: src.jobId,
        action: 'outsource_broadcast',
        route: 'service',
        serviceId: candidate.id,
        status: execResult.execution?.status,
      });
    }
  } catch (e) {
    decisions.push({ action: 'outsource_skip', reason: 'cycle_failed', error: e.message });
  }

  saveJson(STATE, state);
  saveJson(PENDING, pending);

  out({
    success: true,
    fullAutonomy,
    accountIndex,
    accountAddress,
    escrowAddress,
    maxFeePerDayRaw,
    decisions,
    pendingCount: (pending.items || []).length,
  });
}

main().catch((e) => fail(e.message));
