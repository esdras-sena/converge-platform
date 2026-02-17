#!/usr/bin/env node
/**
 * converge-platform: estimate-invoke-fee.js
 *
 * Preflight: estimate fee/resource bounds for a single call or multicall.
 * Requires contract ABI on-chain (so this works post-deploy).
 *
 * INPUT: JSON as first argument
 * {
 *   "accountAddress": "0x...",
 *   "rpcUrl": "https://..." (optional),
 *   "calls": [
 *     {"contractAddress":"0x...","method":"...","args":[...]}
 *   ]
 * }
 */

import { Provider, Account, Contract } from 'starknet';
import {
  DEFAULT_RPC_MAINNET,
  jsonStringifySafe,
  fail,
  resolveArtifactForAddress,
  readPrivateKey,
} from './_lib.js';

async function buildPopulatedCalls(provider, calls) {
  const cache = new Map();
  const populated = [];

  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (!c.contractAddress) throw new Error(`Call ${i}: missing contractAddress`);
    if (!c.method) throw new Error(`Call ${i}: missing method`);

    let abi = cache.get(c.contractAddress);
    if (!abi) {
      const cls = await provider.getClassAt(c.contractAddress);
      if (!cls.abi) throw new Error(`Call ${i}: contract has no ABI on chain`);
      abi = cls.abi;
      cache.set(c.contractAddress, abi);
    }

    const contract = new Contract({ abi, address: c.contractAddress, providerOrAccount: provider });
    populated.push(contract.populate(c.method, c.args || []));
  }

  return populated;
}

async function main() {
  const raw = process.argv[2];
  if (!raw) fail('No input.');

  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    fail(`JSON parse error: ${e.message}`);
  }

  if (!input.accountAddress) fail('Missing "accountAddress".');
  if (!Array.isArray(input.calls) || input.calls.length === 0) fail('Missing non-empty "calls" array.');

  const { artifact } = resolveArtifactForAddress(input.accountAddress);
  const privateKey = readPrivateKey(artifact.privateKeyPath);

  const provider = new Provider({ nodeUrl: input.rpcUrl || DEFAULT_RPC_MAINNET });
  const account = new Account({ provider, address: artifact.address, signer: privateKey });

  const populatedCalls = await buildPopulatedCalls(provider, input.calls);
  const estimate = await account.estimateInvokeFee(populatedCalls);

  console.log(
    jsonStringifySafe({
      success: true,
      accountAddress: artifact.address,
      callCount: input.calls.length,
      estimate,
    })
  );
}

main().catch((err) => fail(err?.message || String(err), err?.stack));
