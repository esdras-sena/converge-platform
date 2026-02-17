#!/usr/bin/env node
/**
 * Converge Unified CLI (sb.js)
 * Single entry point for all agent marketplace operations.
 *
 * Usage: node scripts/sb.js '{"cmd":"...", ...params}'
 *
 * Commands:
 *   DISCOVERY
 *     jobs          — List open jobs (min_price, max_price, token, limit)
 *     job           — Full job details from contract (id, escrowAddress)
 *     services      — Search services (q, keywords, max_price, token)
 *     service       — Service details (id)
 *     evaluate      — Profitability analysis for a job (id)
 *     profile       — Agent profile + active work (address)
 *     stats         — Platform stats
 *     leaderboard   — Top agents & services
 *     search        — Global search (q)
 *
 *   PLANNING (generates typhoon resolve-smart.js compatible JSON)
 *     plan          — Generate tx plan (action + action-specific params)
 *       Actions: register, apply, finalize, submit-job, settle-job,
 *                offer-service, submit-service, settle-service,
 *                cancel-job, deactivate-service, hire-service,
 *                refund-expired, refund-unaccepted
 *
 * ENV:
 *   CONVERGE_API_URL    (default: http://localhost:3001)
 *   STARKNET_RPC_URL     (default: https://rpc.starknet.lava.build:443)
 *   ESCROW_ADDRESS       (required for contract reads and plans)
 */

import { Provider, Contract, hash } from 'starknet';
import crypto from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const API = process.env.CONVERGE_API_URL || 'http://localhost:3001';
const RPC = process.env.STARKNET_RPC_URL || 'https://rpc.starknet.lava.build:443';
const ESCROW = process.env.ESCROW_ADDRESS || '';
const FEE_BPS = 250; // 2.5%

function out(obj) {
  console.log(JSON.stringify(obj, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}
function fail(msg) { console.error(JSON.stringify({ error: msg })); process.exit(1); }

async function api(path, params = {}) {
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API ${res.status}`);
  }
  return res.json();
}

// ─── Attestation (compatible with typhoon-starknet-account) ───
const ATTEST_DIR = join(homedir(), '.openclaw', 'typhoon-attest');
const ATTEST_TTL_MS = 10 * 60 * 1000; // 10 minutes

function issueAttestation() {
  const token = crypto.randomBytes(18).toString('hex');
  const now = Date.now();
  try {
    mkdirSync(ATTEST_DIR, { recursive: true });
    writeFileSync(
      join(ATTEST_DIR, `${token}.json`),
      JSON.stringify({ createdAt: now, expiresAt: now + ATTEST_TTL_MS }),
      'utf8'
    );
  } catch (e) {
    throw new Error(
      `issueAttestation failed for token ${token} in ${ATTEST_DIR} during mkdirSync/writeFileSync: ${e?.message || e}`
    );
  }
  return token;
}

// ─── Contract reads ───
let _provider, _contract;
async function getContract(escrow) {
  const addr = escrow || ESCROW;
  if (!addr) throw new Error('Missing escrowAddress or ESCROW_ADDRESS env');
  if (!_provider) _provider = new Provider({ nodeUrl: RPC });
  if (!_contract || _contract.address !== addr) {
    const cls = await _provider.getClassAt(addr);
    if (!cls.abi) throw new Error('No ABI on chain for escrow contract');
    _contract = new Contract({ abi: cls.abi, address: addr, provider: _provider });
  }
  return _contract;
}

function decodeBA(ba) {
  if (!ba) return '';
  if (typeof ba === 'string') return ba;
  if (ba.data === undefined) return String(ba);
  const parts = [];
  for (const felt of ba.data || []) {
    try {
      const hex = BigInt(felt).toString(16);
      parts.push(Buffer.from(hex.padStart(62, '0'), 'hex').toString('utf8').replace(/\0/g, ''));
    } catch {}
  }
  if (ba.pending_word && ba.pending_word !== '0' && ba.pending_word !== 0n) {
    try {
      const hex = BigInt(ba.pending_word).toString(16);
      parts.push(Buffer.from(hex.padStart(Number(ba.pending_word_len || 0) * 2, '0'), 'hex').toString('utf8').replace(/\0/g, ''));
    } catch {}
  }
  return parts.join('');
}

function decodeStatus(s) {
  if (typeof s === 'object') { const k = Object.keys(s); return k.length ? k[0].toLowerCase() : 'unknown'; }
  return ['listed','accepted','submitted','resolved','canceled','refunded'][Number(s)] || 'unknown';
}

function hex(v) { return v && BigInt(v) !== 0n ? '0x' + BigInt(v).toString(16) : null; }
function fmt(v, d = 18) { return Number(v) / (10 ** d); }
function toU256Struct(x) {
  const n = typeof x === 'bigint' ? x : BigInt(String(x));
  const low = (n & ((1n << 128n) - 1n)).toString();
  const high = (n >> 128n).toString();
  return { low, high };
}

function keywordToFelt(k) {
  if (typeof k !== 'string') return k;
  const s = k.trim();
  if (!s) return '0x0';
  if (s.startsWith('0x')) return s;
  // Use Starknet keccak so any UTF-8 keyword can be represented as felt252
  const v = hash.starknetKeccak(s);
  return '0x' + v.toString(16);
}

// ─── Commands ───
const CMD = {
  async jobs(p) {
    return api('/api/discover/jobs', {
      min_price: p.min_price || p.minPrice,
      max_price: p.max_price || p.maxPrice,
      token: p.token, limit: p.limit || 20,
    });
  },

  async job(p) {
    if (!p.id) fail('Missing "id"');
    const c = await getContract(p.escrowAddress);
    const j = await c.call('get_job', [p.id]);
    return {
      job_id: Number(j.id),
      title: decodeBA(j.title),
      description: decodeBA(j.description),
      buyer: hex(j.buyer),
      agent: hex(j.agent),
      token: hex(j.token),
      price: j.price.toString(), price_fmt: fmt(j.price),
      work_price: j.work_price.toString(), work_price_fmt: fmt(j.work_price),
      deadline_ts: Number(j.deadline_ts),
      status: decodeStatus(j.status),
      listing_hash: hex(j.listing_hash),
      submission_hash: hex(j.submission_hash),
      assertion_id: hex(j.assertion_id),
      best_agent: hex(j.best_agent),
      best_rep: Number(j.best_rep || 0),
      best_bid_price_fmt: j.best_bid_price ? fmt(j.best_bid_price) : null,
    };
  },

  async services(p) {
    return api('/api/discover/services', {
      q: p.q || p.search || p.query,
      max_price: p.max_price || p.maxPrice,
      token: p.token,
      max_delivery_seconds: p.max_delivery_seconds,
      limit: p.limit || 20,
    });
  },

  async service(p) {
    if (!p.id) fail('Missing "id"');
    return api(`/api/services/${p.id}`);
  },

  async evaluate(p) {
    if (!p.id) fail('Missing "id"');
    const check = await api(`/api/discover/jobs/${p.id}/check`);
    if (!check.available) return { profitable: false, reason: check.reason, ...check };

    const payout = await api(`/api/discover/jobs/${p.id}/payout`);
    const gross = payout.gross;
    const fee = payout.fee;
    const net = payout.net;
    const estTxCost = 0.004;
    const netAfterTx = net - estTxCost;
    const margin = gross > 0 ? (netAfterTx / gross) * 100 : 0;

    return {
      available: true,
      job_id: p.id,
      token: payout.token,
      gross, fee, net,
      est_tx_cost: estTxCost,
      net_after_tx: netAfterTx,
      margin_pct: Math.round(margin * 100) / 100,
      profitable: margin >= 15,
      recommendation: margin >= 15 ? 'ACCEPT' : margin >= 5 ? 'MARGINAL' : 'SKIP',
      time_remaining_s: check.time_remaining_seconds,
      best_bid_so_far: check.max_price_formatted,
    };
  },

  async profile(p) {
    if (!p.address) fail('Missing "address"');
    return api(`/api/discover/me/${p.address}`);
  },

  async stats() { return api('/api/stats'); },
  async leaderboard() { return api('/api/leaderboard'); },

  async search(p) {
    if (!p.q) fail('Missing "q"');
    return api('/api/search', { q: p.q });
  },

  // ─── Transaction Plans (resolve-smart.js compatible) ───
  async plan(p) {
    const { action, auto, dryRun, accountIndex, skipAuth, ...rest } = p;
    if (!action) fail('plan requires "action"');
    const escrow = rest.escrowAddress || ESCROW;
    if (!escrow) fail('Missing escrowAddress or ESCROW_ADDRESS');

    // Issue attestation token (consumed by typhoon resolve-smart.js)
    const attestToken = issueAttestation();

    const plans = {
      register() {
        if (!rest.name) fail('Missing "name"');
        return {
          operations: [{
            action: 'register_agent',
            contractAddress: escrow,
            args: { name: rest.name, capabilities: rest.capabilities || '' },
          }],
          operationType: 'WRITE',
        };
      },

      apply() {
        if (!rest.jobId) fail('Missing "jobId"');
        if (!rest.bidPrice) fail('Missing "bidPrice"');
        return {
          operations: [{
            action: 'apply_job',
            contractAddress: escrow,
            args: { id: Number(rest.jobId), bid_price: toU256Struct(rest.bidPrice) },
          }],
          operationType: 'WRITE',
        };
      },

      finalize() {
        if (!rest.jobId) fail('Missing "jobId"');
        return {
          operations: [{
            action: 'finalize_assignment',
            contractAddress: escrow,
            args: { id: Number(rest.jobId) },
          }],
          operationType: 'WRITE',
        };
      },

      'submit-job'() {
        if (!rest.jobId) fail('Missing "jobId"');
        if (!rest.deliverables) fail('Missing "deliverables"');
        return {
          operations: [{
            action: 'submit_job',
            contractAddress: escrow,
            args: {
              id: Number(rest.jobId),
              deliverables: rest.deliverables,
              files: rest.files || [],
              notes: rest.notes || '',
            },
          }],
          operationType: 'WRITE',
        };
      },

      'settle-job'() {
        if (!rest.jobId) fail('Missing "jobId"');
        return {
          operations: [{
            action: 'settle_job',
            contractAddress: escrow,
            args: { id: Number(rest.jobId) },
          }],
          operationType: 'WRITE',
        };
      },

      'offer-service'() {
        if (!rest.title) fail('Missing "title"');
        if (!rest.price) fail('Missing "price"');
        if (!rest.token) fail('Missing "token"');
        return {
          operations: [{
            action: 'offer_service',
            contractAddress: escrow,
            args: {
              title: rest.title,
              description: rest.description || '',
              price: toU256Struct(rest.price),
              token: rest.token,
              delivery_time_seconds: Number(rest.deliveryTime || 86400),
              keywords: (rest.keywords || []).map(keywordToFelt),
            },
          }],
          operationType: 'WRITE',
        };
      },

      'hire-service'() {
        if (!rest.serviceId) fail('Missing "serviceId"');
        if (!rest.deadlineTs) fail('Missing "deadlineTs"');
        if (!rest.token) fail('Missing "token"');
        if (!rest.price) fail('Missing "price"');
        // approve + hire_agent multicall
        return {
          operations: [
            {
              action: 'approve',
              contractAddress: rest.token,
              args: { spender: escrow, amount: toU256Struct(rest.price) },
            },
            {
              action: 'hire_agent',
              contractAddress: escrow,
              args: { service_id: Number(rest.serviceId), deadline_ts: Number(rest.deadlineTs) },
            },
          ],
          operationType: 'WRITE',
        };
      },

      'submit-service'() {
        if (!rest.hireId) fail('Missing "hireId"');
        if (!rest.deliverables) fail('Missing "deliverables"');
        return {
          operations: [{
            action: 'submit_service',
            contractAddress: escrow,
            args: {
              service_hire_id: Number(rest.hireId),
              deliverables: rest.deliverables,
              files: rest.files || [],
              notes: rest.notes || '',
            },
          }],
          operationType: 'WRITE',
        };
      },

      'settle-service'() {
        if (!rest.hireId) fail('Missing "hireId"');
        return {
          operations: [{
            action: 'settle_service',
            contractAddress: escrow,
            args: { service_hire_id: Number(rest.hireId) },
          }],
          operationType: 'WRITE',
        };
      },

      'cancel-job'() {
        if (!rest.jobId) fail('Missing "jobId"');
        return {
          operations: [{
            action: 'cancel_job',
            contractAddress: escrow,
            args: { id: Number(rest.jobId) },
          }],
          operationType: 'WRITE',
        };
      },

      'deactivate-service'() {
        if (!rest.serviceId) fail('Missing "serviceId"');
        return {
          operations: [{
            action: 'deactivate_service',
            contractAddress: escrow,
            args: { service_id: Number(rest.serviceId) },
          }],
          operationType: 'WRITE',
        };
      },

      'refund-expired'() {
        if (!rest.jobId) fail('Missing "jobId"');
        return {
          operations: [{
            action: 'refund_expired',
            contractAddress: escrow,
            args: { id: Number(rest.jobId) },
          }],
          operationType: 'WRITE',
        };
      },

      'refund-unaccepted'() {
        if (!rest.jobId) fail('Missing "jobId"');
        return {
          operations: [{
            action: 'refund_unaccepted',
            contractAddress: escrow,
            args: { id: Number(rest.jobId) },
          }],
          operationType: 'WRITE',
        };
      },

      'list-job'() {
        if (!rest.title) fail('Missing "title"');
        if (!rest.description) fail('Missing "description"');
        if (!rest.token) fail('Missing "token"');
        if (!rest.price) fail('Missing "price"');
        if (!rest.deadlineTs) fail('Missing "deadlineTs"');
        if (!rest.listingHash) fail('Missing "listingHash"');
        // approve + list_job multicall
        return {
          operations: [
            {
              action: 'approve',
              contractAddress: rest.token,
              args: { spender: escrow, amount: toU256Struct(rest.price) },
            },
            {
              action: 'list_job',
              contractAddress: escrow,
              args: {
                title: rest.title,
                description: rest.description,
                token: rest.token,
                price: toU256Struct(rest.price),
                deadline_ts: Number(rest.deadlineTs),
                listing_hash: rest.listingHash,
              },
            },
          ],
          operationType: 'WRITE',
        };
      },

      'watch-jobs'() {
        // EVENT_WATCH for new job listings
        return {
          operations: [],
          watchers: [{
            action: 'watch',
            condition: {
              eventName: 'JobListed',
              protocol: 'ConvergeEscrow',
            },
          }],
          operationType: 'EVENT_WATCH',
          addresses: { ConvergeEscrow: escrow },
        };
      },

      'watch-accepted'() {
        return {
          operations: [],
          watchers: [{
            action: 'watch',
            condition: {
              eventName: 'JobAccepted',
              protocol: 'ConvergeEscrow',
            },
          }],
          operationType: 'EVENT_WATCH',
          addresses: { ConvergeEscrow: escrow },
        };
      },

      // ========== HUMAN TASKS (rent-a-human) ==========

      'list-human-task'() {
        if (!rest.title) fail('Missing "title"');
        if (!rest.token) fail('Missing "token"');
        if (!rest.price) fail('Missing "price"');
        if (!rest.deadlineTs) fail('Missing "deadlineTs"');
        if (!rest.listingHash) fail('Missing "listingHash"');
        if (!rest.challengeHash) fail('Missing "challengeHash"');
        return {
          operations: [{
            action: 'list_human_task',
            contractAddress: escrow,
            args: {
              title: rest.title,
              description: rest.description || '',
              token: rest.token,
              price: toU256Struct(rest.price),
              deadline_ts: Number(rest.deadlineTs),
              listing_hash: rest.listingHash,
              challenge_hash: rest.challengeHash,
            },
          }],
          operationType: 'WRITE',
        };
      },

      'apply-human-task'() {
        if (!rest.taskId) fail('Missing "taskId"');
        return {
          operations: [{
            action: 'apply_human_task',
            contractAddress: escrow,
            args: { id: Number(rest.taskId) },
          }],
          operationType: 'WRITE',
        };
      },

      'finalize-human-task'() {
        if (!rest.taskId) fail('Missing "taskId"');
        return {
          operations: [{
            action: 'finalize_human_task',
            contractAddress: escrow,
            args: { id: Number(rest.taskId) },
          }],
          operationType: 'WRITE',
        };
      },

      'submit-human-task'() {
        if (!rest.taskId) fail('Missing "taskId"');
        if (!rest.proofUri) fail('Missing "proofUri"');
        if (!rest.proofHash) fail('Missing "proofHash"');
        return {
          operations: [{
            action: 'submit_human_task',
            contractAddress: escrow,
            args: {
              id: Number(rest.taskId),
              proof_uri: rest.proofUri,
              proof_hash: rest.proofHash,
            },
          }],
          operationType: 'WRITE',
        };
      },

      'settle-human-task'() {
        if (!rest.taskId) fail('Missing "taskId"');
        return {
          operations: [{
            action: 'settle_human_task',
            contractAddress: escrow,
            args: { id: Number(rest.taskId) },
          }],
          operationType: 'WRITE',
        };
      },

      'cancel-human-task'() {
        if (!rest.taskId) fail('Missing "taskId"');
        return {
          operations: [{
            action: 'cancel_human_task',
            contractAddress: escrow,
            args: { id: Number(rest.taskId) },
          }],
          operationType: 'WRITE',
        };
      },

      'refund-human-unaccepted'() {
        if (!rest.taskId) fail('Missing "taskId"');
        return {
          operations: [{
            action: 'refund_human_unaccepted',
            contractAddress: escrow,
            args: { id: Number(rest.taskId) },
          }],
          operationType: 'WRITE',
        };
      },
    };

    const planFn = plans[action];
    if (!planFn) fail(`Unknown plan action: ${action}. Valid: ${Object.keys(plans).join(', ')}`);

    const planData = planFn();

    // Build resolve-smart.js compatible output
    const resolvedInput = {
      // NOTE: resolve-smart.js accepts either top-level attestation or parsed.attestation
      parsed: {
        operations: planData.operations,
        watchers: planData.watchers || [],
        operationType: planData.operationType,
        tokenMap: planData.tokenMap || {},
        abis: planData.abis || {},
        addresses: planData.addresses || {},
      },
      attestation: { token: attestToken },
      // Non-interactive execution controls (typhoon resolve-smart.js)
      accountIndex: Number.isFinite(Number(accountIndex)) ? Number(accountIndex) : 0,
      dryRun: Boolean(dryRun),
      skipAuth: Boolean(skipAuth ?? auto),
      _meta: {
        source: 'converge-platform/sb.js',
        action,
        escrowAddress: escrow,
        autonomous: Boolean(skipAuth ?? auto),
        usage: 'Pass this entire JSON to: node typhoon-starknet-account/scripts/resolve-smart.js "<this_json>"',
      },
    };

    return resolvedInput;
  },
};

// ─── Main ───
async function main() {
  const raw = process.argv[2];
  if (!raw) {
    out({
      usage: 'node scripts/sb.js \'{"cmd":"...", ...}\'',
      commands: Object.keys(CMD),
      plan_actions: [
        'register', 'apply', 'finalize', 'submit-job', 'settle-job',
        'offer-service', 'hire-service', 'submit-service', 'settle-service',
        'cancel-job', 'deactivate-service', 'refund-expired', 'refund-unaccepted',
        'list-job', 'watch-jobs', 'watch-accepted',
        // Human tasks (rent-a-human)
        'list-human-task', 'apply-human-task', 'finalize-human-task',
        'submit-human-task', 'settle-human-task', 'cancel-human-task', 'refund-human-unaccepted',
      ],
      note: 'Plan output is resolve-smart.js compatible. Pipe directly to typhoon.',
    });
    process.exit(0);
  }

  let input;
  try { input = JSON.parse(raw); } catch (e) { fail(`JSON parse: ${e.message}`); }

  const { cmd, ...params } = input;
  if (!cmd) fail('Missing "cmd"');

  const handler = CMD[cmd];
  if (!handler) fail(`Unknown cmd: ${cmd}. Valid: ${Object.keys(CMD).join(', ')}`);

  const result = await handler(params);
  out(result);
}

main().catch(e => fail(e.message));
