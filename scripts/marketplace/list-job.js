#!/usr/bin/env node
/**
 * Wrapper: ConvergeEscrow.list_job(title, description, token, price, deadline_ts, listing_hash)
 * 
 * Buyer lists a job and escrows funds in one transaction.
 * 
 * NOTE: Buyer must approve the escrow contract to transfer_from(token, price) first!
 * 
 * Returns: job_id
 */

import { helpCommon, parseHexOrDecFelt, parseU256, parseU64 } from './_marketplace.js';
import { jsonStringifySafe, fail } from '../_lib.js';

function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.log(
      jsonStringifySafe({
        ok: false,
        usage:
          "node scripts/marketplace/list-job.js '{\"accountAddress\":\"0x...\",\"escrowAddress\":\"0x...\",\"title\":\"Build a contract\",\"description\":\"I need...\",\"token\":\"0x...\",\"price\":\"1000000000000000000\",\"deadlineTs\":1700000000,\"listingHash\":\"0x...\"}'",
        notes: [
          "Escrows funds immediately (approve token first!)",
          "title and description are stored onchain",
          "listingHash can point to IPFS for extended metadata",
          "Returns job_id on success",
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
  const title = input.title;
  const description = input.description;
  const token = parseHexOrDecFelt(input.token, 'token');
  const price = parseU256(input.price, 'price');
  const deadlineTs = parseU64(input.deadlineTs, 'deadlineTs');
  const listingHash = parseHexOrDecFelt(input.listingHash, 'listingHash');

  if (!title || typeof title !== 'string') {
    fail('title is required (string)');
  }
  if (!description || typeof description !== 'string') {
    fail('description is required (string)');
  }

  const call = {
    contractAddress: escrowAddress,
    method: 'list_job',
    args: [title, description, token, price, deadlineTs, listingHash],
  };

  console.log(
    jsonStringifySafe({
      success: true,
      action: 'list_job',
      accountAddress,
      title,
      description,
      token,
      price: price.toString ? price.toString() : JSON.stringify(price),
      deadlineTs,
      listingHash,
      callsForEstimate: { accountAddress, calls: [call] },
      invokePayload: {
        accountAddress,
        contractAddress: escrowAddress,
        method: 'list_job',
        args: call.args,
      },
      reminder:
        'Approve token transfer first! Then estimate (scripts/estimate-invoke-fee.js). Broadcast only after confirmation.',
    })
  );
}

main();
