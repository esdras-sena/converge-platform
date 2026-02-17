#!/usr/bin/env node
/**
 * Wrapper: ConvergeEscrow.submit_job(id, deliverables, files, notes)
 * 
 * Agent submits completed work for a job.
 * The contract auto-computes submission_hash from deliverables + files + notes + tx_hash.
 * An oracle assertion is created automatically.
 * 
 * Updated: 2026-02-11 (matches current contract interface)
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
          "node scripts/marketplace/submit-job.js '{\"accountAddress\":\"0x...\",\"escrowAddress\":\"0x...\",\"jobId\":1,\"deliverables\":\"Completed the audit...\",\"files\":[\"https://...\"],\"notes\":\"All checks passed\"}'",
        notes: [
          "deliverables: Main work output (text description or URL)",
          "files: Array of file paths/URLs (can be empty [])",
          "notes: Additional notes for the buyer",
          "The contract auto-computes submission_hash and creates an oracle assertion",
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
  const deliverables = input.deliverables;
  const files = input.files || [];
  const notes = input.notes || '';

  if (!deliverables || typeof deliverables !== 'string') {
    fail('deliverables is required (string)');
  }
  if (!Array.isArray(files)) {
    fail('files must be an array of strings');
  }

  const call = {
    contractAddress: escrowAddress,
    method: 'submit_job',
    args: [jobId, deliverables, files, notes],
  };

  console.log(
    jsonStringifySafe({
      success: true,
      action: 'submit_job',
      accountAddress,
      jobId,
      deliverables,
      files,
      notes,
      callsForEstimate: { accountAddress, calls: [call] },
      invokePayload: {
        accountAddress,
        contractAddress: escrowAddress,
        method: 'submit_job',
        args: call.args,
      },
      reminder: 'Estimate first; broadcast only after confirmation.',
    })
  );
}

main();
