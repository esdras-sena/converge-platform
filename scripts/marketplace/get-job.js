#!/usr/bin/env node
/**
 * converge-platform: get-job.js
 * 
 * Fetch full job details from the contract (title, description, etc.)
 * The indexer only has event data; this fetches the complete Job struct.
 * 
 * USAGE:
 *   node scripts/marketplace/get-job.js '{"escrowAddress":"0x...","jobId":42}'
 * 
 * OUTPUT:
 *   Full job struct including title, description, status, prices, etc.
 */

import { Provider, Contract } from 'starknet';

const RPC_URL = process.env.STARKNET_RPC_URL || 'https://rpc.starknet.lava.build:443';

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

async function main() {
  const raw = process.argv[2];
  if (!raw) fail('No input. Pass JSON with escrowAddress and jobId.');

  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    fail(`JSON parse error: ${e.message}`);
  }

  const { escrowAddress, jobId } = input;
  if (!escrowAddress) fail('Missing "escrowAddress".');
  if (jobId === undefined) fail('Missing "jobId".');

  const provider = new Provider({ nodeUrl: RPC_URL });

  // Get contract ABI
  const classResponse = await provider.getClassAt(escrowAddress);
  if (!classResponse.abi) fail('Contract has no ABI on chain.');

  const contract = new Contract({
    abi: classResponse.abi,
    address: escrowAddress,
    provider,
  });

  // Call get_job
  const job = await contract.call('get_job', [jobId]);

  // Decode ByteArray fields (title, description)
  const decodeByteArray = (ba) => {
    if (!ba) return '';
    // ByteArray in Cairo is { data: felt252[], pending_word: felt252, pending_word_len: u32 }
    // For simplicity, try to decode if it's a simple structure
    if (typeof ba === 'string') return ba;
    if (ba.data !== undefined) {
      // Decode felt252 array to string
      const parts = [];
      for (const felt of ba.data || []) {
        try {
          const hex = BigInt(felt).toString(16);
          const bytes = Buffer.from(hex.padStart(62, '0'), 'hex');
          parts.push(bytes.toString('utf8').replace(/\0/g, ''));
        } catch {}
      }
      if (ba.pending_word && ba.pending_word !== '0' && ba.pending_word !== 0n) {
        try {
          const hex = BigInt(ba.pending_word).toString(16);
          const bytes = Buffer.from(hex.padStart(Number(ba.pending_word_len || 0) * 2, '0'), 'hex');
          parts.push(bytes.toString('utf8').replace(/\0/g, ''));
        } catch {}
      }
      return parts.join('');
    }
    return String(ba);
  };

  // Format output
  const result = {
    job_id: Number(job.id),
    title: decodeByteArray(job.title),
    description: decodeByteArray(job.description),
    buyer: '0x' + BigInt(job.buyer).toString(16),
    agent: job.agent && BigInt(job.agent) !== 0n ? '0x' + BigInt(job.agent).toString(16) : null,
    token: '0x' + BigInt(job.token).toString(16),
    price: job.price.toString(),
    price_formatted: Number(job.price) / 1e18,
    work_price: job.work_price.toString(),
    work_price_formatted: Number(job.work_price) / 1e18,
    deadline_ts: Number(job.deadline_ts),
    status: decodeJobStatus(job.status),
    listing_hash: '0x' + BigInt(job.listing_hash).toString(16),
    submission_hash: job.submission_hash && BigInt(job.submission_hash) !== 0n 
      ? '0x' + BigInt(job.submission_hash).toString(16) 
      : null,
    assertion_id: job.assertion_id && BigInt(job.assertion_id) !== 0n
      ? '0x' + BigInt(job.assertion_id).toString(16)
      : null,
    // Bidding info
    best_agent: job.best_agent && BigInt(job.best_agent) !== 0n 
      ? '0x' + BigInt(job.best_agent).toString(16) 
      : null,
    best_rep: Number(job.best_rep || 0),
    best_bid_price: job.best_bid_price ? job.best_bid_price.toString() : null,
    best_bid_price_formatted: job.best_bid_price ? Number(job.best_bid_price) / 1e18 : null,
  };

  console.log(JSON.stringify(result, null, 2));
}

function decodeJobStatus(status) {
  // JobStatus enum in Cairo
  if (status === undefined || status === null) return 'unknown';
  if (typeof status === 'object') {
    // Enum variant
    const keys = Object.keys(status);
    if (keys.length > 0) return keys[0].toLowerCase();
  }
  const statusMap = {
    0: 'listed',
    1: 'accepted',
    2: 'submitted',
    3: 'approved',
    4: 'disputed',
    5: 'resolved',
    6: 'canceled',
    7: 'refunded',
  };
  return statusMap[Number(status)] || 'unknown';
}

main().catch(err => fail(err.message));
