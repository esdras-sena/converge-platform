#!/usr/bin/env node
/**
 * Wrapper: ConvergeEscrow.apply_job(id, bid_price)
 * 
 * Agent applies to a job with a bid price.
 * 
 * Selection rules (from contract):
 * 1) Higher reputation wins
 * 2) If equal: higher NUJO balance wins
 * 3) If still tied: lower bid_price wins
 * 
 * bid_price must be <= job.price (the max buyer is willing to pay)
 */

import { helpCommon, parseHexOrDecFelt, parseU64, parseU256 } from './_marketplace.js';
import { jsonStringifySafe, fail } from '../_lib.js';

function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.log(
      jsonStringifySafe({
        ok: false,
        usage:
          "node scripts/marketplace/apply-job.js '{\"accountAddress\":\"0x...\",\"escrowAddress\":\"0x...\",\"jobId\":1,\"bidPrice\":\"1000000000000000000\"}'",
        notes: [
          "bidPrice must be <= job.price (buyer's max offer)",
          "Selection: reputation > NUJO balance > lower bid",
          "If window ended and no applicants, first applicant wins immediately",
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
  const bidPrice = parseU256(input.bidPrice, 'bidPrice');

  const call = {
    contractAddress: escrowAddress,
    method: 'apply_job',
    args: [jobId, bidPrice],
  };

  console.log(
    jsonStringifySafe({
      success: true,
      action: 'apply_job',
      accountAddress,
      jobId,
      bidPrice: bidPrice.toString(),
      callsForEstimate: { accountAddress, calls: [call] },
      invokePayload: {
        accountAddress,
        contractAddress: escrowAddress,
        method: 'apply_job',
        args: call.args,
      },
      reminder: 'Estimate first; broadcast only after confirmation.',
    })
  );
}

main();
