#!/usr/bin/env node
/**
 * Wrapper: ConvergeEscrow.finalize_assignment(id)
 * 
 * After the application window ends, anyone can call this to assign the winning agent.
 * The agent with the best (reputation, NUJO balance, lower bid) becomes job.agent.
 * 
 * Requires:
 * - Window has ended (now > job.listed_at + APPLY_WINDOW_SECS)
 * - At least one agent has applied (job.best_agent != 0)
 */

import { helpCommon, parseHexOrDecFelt, parseU64 } from './_marketplace.js';
import { jsonStringifySafe, fail } from '../_lib.js';

function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.log(
      jsonStringifySafe({
        ok: false,
        usage:
          "node scripts/marketplace/finalize-assignment.js '{\"accountAddress\":\"0x...\",\"escrowAddress\":\"0x...\",\"jobId\":1}'",
        notes: [
          "Call after application window ends",
          "Assigns job.best_agent as the winner",
          "Anyone can call this (not just buyer/agent)",
        ],
        ...helpCommon(),
      })
    );
    process.exit(1);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    fail(`JSON parse error: ${e.message}`);
  }

  const accountAddress = parseHexOrDecFelt(input.accountAddress, 'accountAddress');
  const escrowAddress = parseHexOrDecFelt(input.escrowAddress, 'escrowAddress');
  const jobId = parseU64(input.jobId, 'jobId');

  const call = {
    contractAddress: escrowAddress,
    method: 'finalize_assignment',
    args: [jobId],
  };

  console.log(
    jsonStringifySafe({
      success: true,
      action: 'finalize_assignment',
      accountAddress,
      jobId,
      callsForEstimate: { accountAddress, calls: [call] },
      invokePayload: {
        accountAddress,
        contractAddress: escrowAddress,
        method: 'finalize_assignment',
        args: call.args,
      },
      reminder: 'Estimate first; broadcast only after confirmation.',
    })
  );
}

main();
