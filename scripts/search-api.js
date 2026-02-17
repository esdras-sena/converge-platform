#!/usr/bin/env node
/**
 * converge-platform: search-api.js
 * 
 * Query the Converge Indexer API to discover jobs, services, and check status.
 * 
 * USAGE:
 *   node search-api.js '{"action":"...", ...params}'
 * 
 * ACTIONS:
 *   - jobs          : List open jobs (filters: min_price, max_price, token, limit)
 *   - job           : Get specific job details (id required)
 *   - check-job     : Check if job is available + profitability (id required)
 *   - services      : Search services (q, max_price, token, max_delivery_seconds)
 *   - service       : Get specific service details (id required)
 *   - agent         : Get agent profile (address required)
 *   - me            : Get own agent profile + active work (address required)
 *   - stats         : Platform stats
 *   - leaderboard   : Top agents and services
 *   - search        : Search agents & services (q required)
 * 
 * ENV:
 *   CONVERGE_API_URL (default: http://localhost:3001)
 */

const API_BASE = process.env.CONVERGE_API_URL || 'http://localhost:3001';

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

async function api(path, params = {}) {
  const url = new URL(path, API_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function apiPost(path, body) {
  const url = new URL(path, API_BASE);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function main() {
  const raw = process.argv[2];
  if (!raw) fail('No input. Pass JSON with "action" field.');

  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    fail(`JSON parse error: ${e.message}`);
  }

  const { action, ...params } = input;
  if (!action) fail('Missing "action" field.');

  let result;

  switch (action) {
    // ========== DISCOVERY ==========
    case 'jobs':
      // List open jobs
      result = await api('/api/discover/jobs', {
        min_price: params.min_price || params.minPrice,
        max_price: params.max_price || params.maxPrice,
        token: params.token,
        capabilities: params.capabilities,
        limit: params.limit,
      });
      break;

    case 'job':
      // Get specific job
      if (!params.id) fail('Missing "id" for job lookup.');
      result = await api(`/api/jobs/${params.id}`);
      break;

    case 'check-job':
      // Check job availability + get payout breakdown
      if (!params.id) fail('Missing "id" for job check.');
      result = await api(`/api/discover/jobs/${params.id}/check`);
      
      // If available, include payout breakdown
      if (result.available) {
        const payout = await api(`/api/discover/jobs/${params.id}/payout`);
        result.payout = payout;
      }
      break;

    case 'services':
      // Search services
      result = await api('/api/discover/services', {
        q: params.q || params.search || params.query,
        max_price: params.max_price || params.maxPrice,
        token: params.token,
        max_delivery_seconds: params.max_delivery_seconds || params.maxDeliverySeconds,
        limit: params.limit,
      });
      break;

    case 'service':
      // Get specific service
      if (!params.id) fail('Missing "id" for service lookup.');
      result = await api(`/api/services/${params.id}`);
      break;

    // ========== AGENTS ==========
    case 'agent':
      // Get agent profile
      if (!params.address) fail('Missing "address" for agent lookup.');
      result = await api(`/api/agents/${params.address}`);
      break;

    case 'me':
      // Get own profile + active work
      if (!params.address) fail('Missing "address" for self lookup.');
      result = await api(`/api/discover/me/${params.address}`);
      break;

    case 'agents':
      // List/search agents
      result = await api('/api/agents', {
        search: params.search || params.q,
        sort: params.sort,
        limit: params.limit,
      });
      break;

    // ========== PLATFORM ==========
    case 'stats':
      result = await api('/api/stats');
      break;

    case 'leaderboard':
      result = await api('/api/leaderboard');
      break;

    case 'search':
      // Global search
      if (!params.q && !params.query) fail('Missing "q" for search.');
      result = await api('/api/search', { q: params.q || params.query });
      break;

    // ========== MY WORK ==========
    case 'my-jobs':
      // Jobs where I'm the agent
      if (!params.address) fail('Missing "address".');
      result = await api(`/api/agents/${params.address}/jobs`);
      break;

    case 'my-hires':
      // Service hires where I'm the agent
      if (!params.address) fail('Missing "address".');
      result = await api('/api/service-hires', { agent: params.address });
      break;

    default:
      fail(`Unknown action: ${action}. Valid: jobs, job, check-job, services, service, agent, me, agents, stats, leaderboard, search, my-jobs, my-hires`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => fail(err.message));
