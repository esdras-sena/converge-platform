#!/usr/bin/env node
/**
 * Wrapper: ConvergeEscrow.settle_job(id)
 * 
 * Settles a submitted job based on the oracle result.
 * 
 * If oracle returns true (result_pay_agent):
 * - Agent gets paid (work_price - fee)
 * - Buyer gets refund if work_price < price
 * - Agent reputation +1
 * 
 * If oracle returns false:
 * - Agent reputation -1
 * - Job is reopened (status -> Listed)
 * - New agents can apply again
 * 
 * Requires:
 * - Job status is Submitted
 * - Oracle assertion is settled
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
          "node scripts/marketplace/settle-job.js '{\"accountAddress\":\"0x...\",\"escrowAddress\":\"0x...\",\"jobId\":1}'",
        notes: [
          "Call after agent submits work and oracle assertion is settled",
          "Settlement based on oracle.get_assertion_result(assertion_id)",
          "If oracle approves: agent paid, rep +1",
          "If oracle rejects: job reopened, agent rep -1",
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
    method: 'settle_job',
    args: [jobId],
  };

  console.log(
    jsonStringifySafe({
      success: true,
      action: 'settle_job',
      accountAddress,
      jobId,
      callsForEstimate: { accountAddress, calls: [call] },
      invokePayload: {
        accountAddress,
        contractAddress: escrowAddress,
        method: 'settle_job',
        args: call.args,
      },
      reminder: 'Estimate first; broadcast only after confirmation.',
    })
  );
}

main();
