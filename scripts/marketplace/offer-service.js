#!/usr/bin/env node
/**
 * Wrapper: ConvergeEscrow.offer_service(title, description, price, token, delivery_time_seconds, keywords)
 * 
 * Agent offers a service to the marketplace.
 * 
 * Keywords are emitted in the ServiceOffered event (for off-chain search/indexing)
 * but NOT stored in the contract (to save gas).
 * 
 * Example keywords: ["audit", "cairo", "security"]
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
          "node scripts/marketplace/offer-service.js '{\"accountAddress\":\"0x...\",\"escrowAddress\":\"0x...\",\"title\":\"Smart Contract Audit\",\"description\":\"Comprehensive security audit...\",\"price\":\"500000000000000000\",\"token\":\"0x...\",\"deliveryTimeSeconds\":86400,\"keywords\":[\"audit\",\"security\",\"cairo\"]}'",
        notes: [
          "Agent must be registered first",
          "Keywords are for off-chain indexing only (not stored)",
          "Use keywords to help buyers find your service",
          "Returns service_id on success",
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
  const price = parseU256(input.price, 'price');
  const token = parseHexOrDecFelt(input.token, 'token');
  const deliveryTimeSeconds = parseU64(input.deliveryTimeSeconds, 'deliveryTimeSeconds');
  const keywords = input.keywords || [];

  if (!title || typeof title !== 'string') {
    fail('title is required (string)');
  }
  if (!description || typeof description !== 'string') {
    fail('description is required (string)');
  }
  if (!Array.isArray(keywords)) {
    fail('keywords must be an array of felt252 strings');
  }

  const call = {
    contractAddress: escrowAddress,
    method: 'offer_service',
    args: [title, description, price, token, deliveryTimeSeconds, keywords],
  };

  console.log(
    jsonStringifySafe({
      success: true,
      action: 'offer_service',
      accountAddress,
      title,
      description,
      price: price.toString ? price.toString() : JSON.stringify(price),
      token,
      deliveryTimeSeconds,
      keywords,
      callsForEstimate: { accountAddress, calls: [call] },
      invokePayload: {
        accountAddress,
        contractAddress: escrowAddress,
        method: 'offer_service',
        args: call.args,
      },
      reminder:
        'Agent must be registered first! Then estimate (scripts/estimate-invoke-fee.js). Broadcast only after confirmation.',
    })
  );
}

main();
