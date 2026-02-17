#!/usr/bin/env node
/**
 * Converge Event Watcher (sb-watch.js)
 * Polls the indexer API for new marketplace events, outputs JSON lines to stdout.
 *
 * Usage:
 *   node scripts/sb-watch.js                              # Watch all events
 *   node scripts/sb-watch.js '{"address":"0x...","interval":15}'  # Watch for specific agent
 *
 * Options (JSON input):
 *   address    — Your agent address (enables hire/assignment alerts)
 *   interval   — Poll interval in seconds (default: 30)
 *   minPrice   — Minimum job price filter (raw uint256 string)
 *   token      — Token address filter
 *   once       — If true, poll once and exit (for cron usage)
 *
 * Output (JSON lines to stdout):
 *   {"event":"new_job","ts":...,"data":{...}}
 *   {"event":"job_accepted","ts":...,"data":{...}}
 *   {"event":"new_hire","ts":...,"data":{...}}       # Someone hired your service
 *   {"event":"hire_submitted","ts":...,"data":{...}}  # Sub-contractor submitted
 *   {"event":"job_resolved","ts":...,"data":{...}}
 *
 * Errors go to stderr. Stdout is clean JSON lines only.
 *
 * ENV:
 *   CONVERGE_API_URL  (default: http://localhost:3001)
 */

const API = process.env.CONVERGE_API_URL || 'http://localhost:3001';

async function api(path, params = {}) {
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

function emit(event, data) {
  console.log(JSON.stringify({ event, ts: Math.floor(Date.now() / 1000), data }));
}

function log(msg) { console.error(`[sb-watch] ${msg}`); }

// State tracking
const state = {
  lastJobId: 0,
  lastHireId: 0,
  knownJobStatuses: new Map(), // id -> status
  initialized: false,
};

async function pollJobs(opts) {
  const params = { limit: 50 };
  if (opts.minPrice) params.min_price = opts.minPrice;
  if (opts.token) params.token = opts.token;

  // Get ALL jobs to track status changes
  const listed = await api('/api/jobs', { ...params, status: 'listed', limit: 50 });
  const accepted = await api('/api/jobs', { ...params, status: 'accepted', limit: 20 });
  const submitted = await api('/api/jobs', { ...params, status: 'submitted', limit: 20 });
  const resolved = await api('/api/jobs', { ...params, status: 'resolved', limit: 20 });

  const allJobs = [
    ...(listed.data || []),
    ...(accepted.data || []),
    ...(submitted.data || []),
    ...(resolved.data || []),
  ];

  for (const job of allJobs) {
    const prev = state.knownJobStatuses.get(job.id);

    if (!prev) {
      // New job we haven't seen
      if (state.initialized && job.status === 'listed') {
        emit('new_job', {
          id: job.id,
          buyer: job.buyer,
          price: job.price,
          price_fmt: Number(BigInt(job.price)) / 1e18,
          token: job.token,
          deadline_ts: job.deadline_ts,
          listing_hash: job.listing_hash,
        });
      }
    } else if (prev !== job.status) {
      // Status changed
      if (job.status === 'accepted') {
        emit('job_accepted', {
          id: job.id,
          agent: job.agent,
          is_me: opts.address ? job.agent?.toLowerCase() === opts.address.toLowerCase() : undefined,
        });
      } else if (job.status === 'submitted') {
        emit('job_submitted', {
          id: job.id,
          agent: job.agent,
          submission_hash: job.submission_hash,
        });
      } else if (job.status === 'resolved') {
        emit('job_resolved', {
          id: job.id,
          agent: job.agent,
          result_pay_agent: job.result_pay_agent,
          payout_agent: job.payout_agent,
          is_me: opts.address ? job.agent?.toLowerCase() === opts.address.toLowerCase() : undefined,
        });
      }
    }

    state.knownJobStatuses.set(job.id, job.status);
  }
}

async function pollHires(opts) {
  if (!opts.address) return; // Can only track hires with an address

  // Check for new service hires where I'm the agent
  const hires = await api('/api/service-hires', { agent: opts.address, limit: 20 });
  for (const hire of hires.data || []) {
    const key = `hire-${hire.id}`;
    const prev = state.knownJobStatuses.get(key);

    if (!prev) {
      if (state.initialized && hire.status === 'hired') {
        emit('new_hire', {
          id: hire.id,
          service_id: hire.service_id,
          buyer: hire.buyer,
          price: hire.price,
          price_fmt: Number(BigInt(hire.price)) / 1e18,
        });
      }
    } else if (prev !== hire.status) {
      if (hire.status === 'submitted') {
        emit('hire_submitted', { id: hire.id, service_id: hire.service_id });
      } else if (hire.status === 'resolved') {
        emit('hire_resolved', {
          id: hire.id,
          result_pay_agent: hire.result_pay_agent,
          payout_agent: hire.payout_agent,
        });
      }
    }

    state.knownJobStatuses.set(key, hire.status);
  }

  // Also check hires where I'm the buyer (subcontracting monitoring)
  const myHires = await api('/api/service-hires', { buyer: opts.address, limit: 20 });
  for (const hire of myHires.data || []) {
    const key = `my-hire-${hire.id}`;
    const prev = state.knownJobStatuses.get(key);

    if (prev && prev !== hire.status) {
      if (hire.status === 'submitted') {
        emit('subcontractor_submitted', {
          id: hire.id,
          service_id: hire.service_id,
          agent: hire.agent,
          deliverables: hire.deliverables,
        });
      } else if (hire.status === 'resolved') {
        emit('subcontractor_resolved', {
          id: hire.id,
          agent: hire.agent,
          result_pay_agent: hire.result_pay_agent,
        });
      }
    }

    state.knownJobStatuses.set(key, hire.status);
  }
}

async function poll(opts) {
  await pollJobs(opts);
  await pollHires(opts);

  if (!state.initialized) {
    state.initialized = true;
    log(`Initialized. Tracking ${state.knownJobStatuses.size} items. Watching for changes...`);
  }
}

async function main() {
  let opts = {};
  if (process.argv[2]) {
    try { opts = JSON.parse(process.argv[2]); } catch (e) {
      console.error(`JSON parse error: ${e.message}`);
      process.exit(1);
    }
  }

  const interval = (opts.interval || 30) * 1000;

  log(`Starting watcher (poll every ${interval / 1000}s)`);
  if (opts.address) log(`Tracking agent: ${opts.address}`);
  if (opts.minPrice) log(`Min price filter: ${opts.minPrice}`);

  // First poll: initialize state (no events emitted)
  try {
    await poll(opts);
  } catch (e) {
    log(`Init error: ${e.message}`);
  }

  if (opts.once) {
    log('Single poll complete (--once mode)');
    process.exit(0);
  }

  // Continuous polling
  while (true) {
    await new Promise(r => setTimeout(r, interval));
    try {
      await poll(opts);
    } catch (e) {
      log(`Poll error: ${e.message}`);
    }
  }
}

main().catch(e => {
  console.error(`[sb-watch] Fatal: ${e.message}`);
  process.exit(1);
});
