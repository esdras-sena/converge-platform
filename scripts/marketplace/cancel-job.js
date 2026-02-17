#!/usr/bin/env node
/**
 * Wrapper: ConvergeEscrow.cancel_job(id)
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
          "node scripts/marketplace/cancel-job.js '{\"accountAddress\":\"0x...\",\"escrowAddress\":\"0x...\",\"jobId\":1}'",
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
    method: 'cancel_job',
    args: [jobId],
  };

  console.log(
    jsonStringifySafe({
      success: true,
      action: 'cancel_job',
      accountAddress,
      callsForEstimate: { accountAddress, calls: [call] },
      invokePayload: {
        accountAddress,
        contractAddress: escrowAddress,
        method: 'cancel_job',
        args: call.args,
      },
      reminder: 'Estimate first; broadcast only after confirmation.',
    })
  );
}

main();
