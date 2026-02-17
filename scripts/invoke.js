#!/usr/bin/env node
/**
 * converge-platform: invoke.js
 *
 * Broadcast a state-changing call.
 * This script intentionally does NOT prompt for confirmation; the agent should confirm in chat first.
 *
 * Requires contract ABI on-chain.
 *
 * INPUT JSON:
 * {
 *   "accountAddress": "0x...",
 *   "rpcUrl": "https://..." (optional),
 *   "contractAddress": "0x...",
 *   "method": "...",
 *   "args": ["..."] (optional),
 *   "waitForTx": true|false (optional, default true)
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
  if (!input.contractAddress) fail('Missing "contractAddress".');
  if (!input.method) fail('Missing "method".');

  const { artifact } = resolveArtifactForAddress(input.accountAddress);
  const privateKey = readPrivateKey(artifact.privateKeyPath);

  const provider = new Provider({ nodeUrl: input.rpcUrl || DEFAULT_RPC_MAINNET });
  const account = new Account({ provider, address: artifact.address, signer: privateKey });

  const cls = await provider.getClassAt(input.contractAddress);
  if (!cls.abi) fail('Contract has no ABI on chain.');

  const contract = new Contract({ abi: cls.abi, address: input.contractAddress, providerOrAccount: account });

  const waitForTx = input.waitForTx !== false;
  const res = await contract.invoke(input.method, input.args || [], { waitForTransaction: waitForTx });

  console.log(
    jsonStringifySafe({
      success: true,
      method: input.method,
      contractAddress: input.contractAddress,
      transactionHash: res.transaction_hash,
      explorer: `https://voyager.online/tx/${res.transaction_hash}`,
      executionStatus: res.execution_status,
      finalityStatus: res.finality_status,
    })
  );
}

main().catch((err) => fail(err?.message || String(err), err?.stack));
