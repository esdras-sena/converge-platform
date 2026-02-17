#!/usr/bin/env node

/**
 * Outsourcing policy gate:
 * - Default: do not outsource
 * - Outsource only if needed (complexity/confidence/deadline/budget)
 * - Route to service lane for specialist tasks
 * - Route to job lane for generic micro tasks
 */

const SPECIALIST_KEYWORDS = [
  'audit', 'security', 'cairo', 'starknet', 'zk', 'game', 'full game',
  '3d', 'multiplayer', 'indexer', 'infra', 'architecture', 'smart contract',
  'formal verification', 'performance tuning', 'tokenomics', 'devops'
];

const MICRO_KEYWORDS = [
  'fix', 'small', 'micro', 'bug', 'copy', 'rename', 'refactor', 'docs',
  'test case', 'ui tweak', 'css', 'minor', 'one screen', 'landing page'
];

function normalize(s) {
  return String(s || '').toLowerCase();
}

export function classifyLane({ title = '', description = '' }) {
  const text = `${normalize(title)} ${normalize(description)}`;
  const specialistHits = SPECIALIST_KEYWORDS.filter(k => text.includes(k)).length;
  const microHits = MICRO_KEYWORDS.filter(k => text.includes(k)).length;

  if (specialistHits >= 1 && specialistHits >= microHits) {
    return { lane: 'service', specialistHits, microHits };
  }
  return { lane: 'job', specialistHits, microHits };
}

export function estimateComplexity({ title = '', description = '' }) {
  const text = `${normalize(title)} ${normalize(description)}`;
  let score = 0;

  if (text.length > 350) score += 20;
  if (text.length > 900) score += 20;

  for (const k of SPECIALIST_KEYWORDS) {
    if (text.includes(k)) score += 12;
  }
  for (const k of MICRO_KEYWORDS) {
    if (text.includes(k)) score -= 6;
  }

  // Clamp 0..100
  score = Math.max(0, Math.min(100, score));
  return score;
}

/**
 * Decide if agent should outsource this task.
 */
export function shouldOutsource({
  task,
  confidence = 0.7,          // 0..1 confidence to complete solo
  deadlineRisk = 0.2,        // 0..1 risk
  availableCreditsRaw = '0', // token base units
  minReserveCreditsRaw = '0',
  maxSubcontractSpendPct = 40,
  expectedSubcontractCostRaw = '0',
  minJobOutsourceComplexity = 22,
}) {
  const complexity = estimateComplexity(task);
  const laneInfo = classifyLane(task);

  const available = BigInt(availableCreditsRaw || '0');
  const reserve = BigInt(minReserveCreditsRaw || '0');
  const expectedCost = BigInt(expectedSubcontractCostRaw || '0');

  const spendCap = (available * BigInt(maxSubcontractSpendPct)) / 100n;
  const budgetOk = available > reserve && expectedCost <= spendCap && (available - expectedCost) >= reserve;

  // Need gate
  const need =
    complexity >= 55 ||
    confidence < 0.55 ||
    deadlineRisk >= 0.65;

  let outsource = need && budgetOk;

  // Hard guard: never outsource trivial tasks through jobs lane.
  if (outsource && laneInfo.lane === 'job' && complexity < minJobOutsourceComplexity) {
    outsource = false;
  }

  return {
    outsource,
    route: outsource ? laneInfo.lane : null,
    reason: outsource
      ? `need=true budget_ok=true lane=${laneInfo.lane}`
      : (laneInfo.lane === 'job' && complexity < minJobOutsourceComplexity
          ? `blocked_trivial_job complexity=${complexity} min=${minJobOutsourceComplexity}`
          : `need=${need} budget_ok=${budgetOk}`),
    metrics: {
      complexity,
      confidence,
      deadlineRisk,
      availableCreditsRaw: available.toString(),
      minReserveCreditsRaw: reserve.toString(),
      expectedSubcontractCostRaw: expectedCost.toString(),
      spendCapRaw: spendCap.toString(),
      ...laneInfo,
    },
  };
}
